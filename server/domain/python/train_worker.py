import argparse
import json
import os
from datasets import Dataset

def run_simulated_training(dataset_path: str, output_dir: str, max_steps: int, is_dpo: bool):
    import time
    print(f"[Worker] [Simulation] Loading dataset from {dataset_path}...")
    with open(dataset_path, "r") as f:
        lines = [line for line in f.readlines() if line.strip()]
    
    print(f"[Worker] [Simulation] Processing {len(lines)} examples...")
    for step in range(1, max_steps + 1):
        time.sleep(0.05) # Simulate processing time
        loss = 1.5 - (step / max_steps) * 1.0 + (step % 3) * 0.05
        print(f"[Worker] [Simulation] Step {step}/{max_steps} - Loss: {loss:.4f}")
        
    print(f"[Worker] [Simulation] Saving dummy adapters to {output_dir}...")
    os.makedirs(output_dir, exist_ok=True)
    with open(os.path.join(output_dir, "adapter_config.json"), "w") as f:
        json.dump({"base_model_name_or_path": "unsloth/llama-3-8b-bnb-4bit", "peft_type": "LORA"}, f)
    with open(os.path.join(output_dir, "dummy_weights.bin"), "w") as f:
        f.write("DUMMY WEIGHTS FOR SIMULATED ENGINE")
        
    print("[Worker] [Simulation] Done!")
    return True

# Lazy load heavy dependencies
def do_training(dataset_path: str, base_model: str, output_dir: str, max_steps: int, is_dpo: bool = False):
    print(f"[Worker] Initializing Unsloth for {base_model}... DPO Mode: {is_dpo}")
    try:
        from unsloth import FastLanguageModel
        from trl import SFTTrainer, DPOTrainer
        from transformers import TrainingArguments
    except (ImportError, NotImplementedError) as e:
        print(f"[Worker] GPU-based Unsloth training not available: {str(e)}")
        print("[Worker] Falling back to Simulated CPU Training Mode...")
        return run_simulated_training(dataset_path, output_dir, max_steps, is_dpo)

    max_seq_length = 2048
    dtype = None # None for auto detection. Float16 for Tesla T4, V100, Bfloat16 for Ampere+
    load_in_4bit = True # Use 4bit quantization to reduce memory usage.

    # 1. Load Base Model
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=base_model,
        max_seq_length=max_seq_length,
        dtype=dtype,
        load_in_4bit=load_in_4bit,
    )

    # 2. Add LoRA Adapters
    model = FastLanguageModel.get_peft_model(
        model,
        r=16, # Choose any number > 0 ! Suggested 8, 16, 32, 64, 128
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj",],
        lora_alpha=16,
        lora_dropout=0, # Supports any, but = 0 is optimized
        bias="none",    # Supports any, but = "none" is optimized
        use_gradient_checkpointing="unsloth",
        random_state=3407,
        use_rslora=False,
        loftq_config=None,
    )

    # 3. Load Dataset
    print(f"[Worker] Loading dataset from {dataset_path}...")
    with open(dataset_path, "r") as f:
        lines = f.readlines()
    
    if is_dpo:
        formatted_data = {"prompt": [], "chosen": [], "rejected": []}
        for line in lines:
            if not line.strip(): continue
            row = json.loads(line.strip())
            prompt_text = f"Below is an instruction that describes a task.\n\n### Instruction:\n{row['prompt']}\n\n### Response:\n"
            formatted_data["prompt"].append(prompt_text)
            formatted_data["chosen"].append(f"{row['chosen']}<|end_of_text|>")
            formatted_data["rejected"].append(f"{row['rejected']}<|end_of_text|>")
    else:
        formatted_data = {"text": []}
        for line in lines:
            if not line.strip(): continue
            row = json.loads(line.strip())
            text = f"Below is an instruction that describes a task.\n\n### Instruction:\n{row['input']}\n\n### Response:\n{row['output']}<|end_of_text|>"
            formatted_data["text"].append(text)

    dataset = Dataset.from_dict(formatted_data)

    # 4. Train Model
    print(f"[Worker] Starting Trainer (DPO={is_dpo})...")
    
    training_args = TrainingArguments(
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        warmup_steps=5,
        max_steps=max_steps,
        learning_rate=2e-4 if not is_dpo else 5e-5, # DPO requires lower LR
        fp16=not FastLanguageModel.is_bfloat16_supported(),
        bf16=FastLanguageModel.is_bfloat16_supported(),
        logging_steps=1,
        optim="adamw_8bit",
        weight_decay=0.01,
        lr_scheduler_type="linear",
        seed=3407,
        output_dir="outputs",
    )
    
    if is_dpo:
        trainer = DPOTrainer(
            model=model,
            ref_model=None, # Unsloth optimizes this by sharing weights for reference model implicitly
            tokenizer=tokenizer,
            train_dataset=dataset,
            max_seq_length=max_seq_length,
            max_prompt_length=max_seq_length // 2,
            beta=0.1,
            args=training_args,
        )
    else:
        trainer = SFTTrainer(
            model=model,
            tokenizer=tokenizer,
            train_dataset=dataset,
            dataset_text_field="text",
            max_seq_length=max_seq_length,
            dataset_num_proc=2,
            packing=False,
            args=training_args,
        )

    trainer_stats = trainer.train()
    print(f"[Worker] Training finished. Stats: {trainer_stats}")

    # 5. Save LoRA Adapters
    print(f"[Worker] Saving LoRA adapters to {output_dir}...")
    os.makedirs(output_dir, exist_ok=True)
    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)

    print("[Worker] Done!")
    return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Student LLM Training Worker")
    parser.add_argument("--dataset", type=str, required=True, help="Path to JSONL dataset")
    parser.add_argument("--base_model", type=str, default="unsloth/llama-3-8b-bnb-4bit", help="HuggingFace model ID")
    parser.add_argument("--output_dir", type=str, required=True, help="Directory to save LoRA weights")
    parser.add_argument("--max_steps", type=int, default=60, help="Number of training steps")
    parser.add_argument("--dpo", action="store_true", help="Run DPOTrainer instead of SFTTrainer")
    
    args = parser.parse_args()
    
    success = do_training(args.dataset, args.base_model, args.output_dir, args.max_steps, args.dpo)
    if not success:
        exit(1)
