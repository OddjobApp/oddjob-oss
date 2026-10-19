import { Command } from "commander";

const program = new Command();

program
    .name("oddjob-cli")
    .description("A CLI for managing the Oddjob project")
    .version("1.0.0");

program.command("users", "Manage users").executableDir(__dirname);
program.command("db", "Manage the database").executableDir(__dirname);
program.command("agents", "Manage agents").executableDir(__dirname);
program.command("missions", "Manage missions").executableDir(__dirname);
program.command("pipelines", "Manage pipelines").executableDir(__dirname);

program.parse();
