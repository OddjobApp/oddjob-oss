import React, { useState } from 'react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { ScrollArea } from '@domain-ui/core/ui/components/ui/scroll-area';
import { 
    HelpCircle, 
    Send, 
    MessageSquare, 
    BrainCircuit,
    ChevronRight,
    Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface ClarifyingQuestion {
    id: string;
    question: string;
    context: string;
    suggestedAnswers?: string[];
}

interface ClarificationInterviewViewProps {
    questions: ClarifyingQuestion[];
    onSubmit: (answers: Record<string, string>) => void;
    isSubmitting: boolean;
}

export function ClarificationInterviewView({ questions, onSubmit, isSubmitting }: ClarificationInterviewViewProps) {
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [currentIdx, setCurrentIdx] = useState(0);

    const currentQuestion = questions[currentIdx];
    const isLast = currentIdx === questions.length - 1;

    const handleNext = () => {
        if (isLast) {
            onSubmit(answers);
        } else {
            setCurrentIdx(prev => prev + 1);
        }
    };

    const handleAnswer = (val: string) => {
        setAnswers(prev => ({ ...prev, [currentQuestion.id]: val }));
    };

    if (!questions.length) return null;

    return (
        <div className="flex flex-col h-full bg-background/40 backdrop-blur-xl">
            <div className="p-6 border-b border-foreground/10 bg-foreground/5 space-y-2">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-lg">
                        <BrainCircuit className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                        <h4 className="text-sm font-black uppercase tracking-tight">Architect Interview</h4>
                        <p className="text-[10px] text-muted-foreground italic font-medium">Refining the Blueprint</p>
                    </div>
                </div>
            </div>

            <ScrollArea className="flex-1">
                <div className="p-8 max-w-lg mx-auto">
                    <AnimatePresence mode="wait">
                        <motion.div 
                            key={currentQuestion.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="space-y-8"
                        >
                            <div className="space-y-4">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/70">Question {currentIdx + 1} of {questions.length}</span>
                                    <div className="h-px flex-1 bg-foreground/5" />
                                </div>
                                <h3 className="text-lg font-black text-foreground leading-tight">
                                    {currentQuestion.question}
                                </h3>
                                <p className="text-[11px] text-muted-foreground leading-relaxed font-medium">
                                    {currentQuestion.context}
                                </p>
                            </div>

                            <div className="space-y-6">
                                <Input 
                                    value={answers[currentQuestion.id] || ''}
                                    onChange={(e) => handleAnswer(e.target.value)}
                                    placeholder="Type your answer here..."
                                    className="bg-background/20 border-foreground/10 h-12 text-sm focus:ring-primary/50"
                                    onKeyDown={(e) => e.key === 'Enter' && answers[currentQuestion.id] && handleNext()}
                                />

                                {currentQuestion.suggestedAnswers && (
                                    <div className="space-y-3">
                                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Suggested Answers</p>
                                        <div className="flex flex-col gap-2">
                                            {currentQuestion.suggestedAnswers.map((suggestion) => (
                                                <button
                                                    key={suggestion}
                                                    onClick={() => handleAnswer(suggestion)}
                                                    className={cn(
                                                        "text-left px-4 py-3 rounded-xl border transition-all text-xs font-bold",
                                                        answers[currentQuestion.id] === suggestion 
                                                            ? "bg-primary/10 border-primary text-primary" 
                                                            : "bg-foreground/5 border-foreground/5 text-muted-foreground hover:border-foreground/20 hover:text-foreground"
                                                    )}
                                                >
                                                    {suggestion}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </AnimatePresence>
                </div>
            </ScrollArea>

            <div className="p-6 border-t border-foreground/10 bg-foreground/5 flex items-center justify-between">
                <Button 
                    variant="ghost" 
                    onClick={() => setCurrentIdx(prev => Math.max(0, prev - 1))}
                    disabled={currentIdx === 0}
                    className="text-xs uppercase font-black tracking-widest"
                >
                    Back
                </Button>
                <Button 
                    onClick={handleNext}
                    disabled={!answers[currentQuestion.id] || isSubmitting}
                    className="gap-2 shadow-lg shadow-primary/20"
                >
                    {isLast ? (
                        <>Finish & Resume <Sparkles className="w-4 h-4" /></>
                    ) : (
                        <>Next Question <ChevronRight className="w-4 h-4" /></>
                    )}
                </Button>
            </div>
        </div>
    );
}
