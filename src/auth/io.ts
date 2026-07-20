import * as readline from 'node:readline';

export interface AuthIO {
  echo(msg: string): void;
  prompt(msg: string, opts?: { choices?: string[] }): Promise<string>;
  /** Like prompt(), but must not echo the typed characters back to the terminal. */
  promptSecret(msg: string): Promise<string>;
  /** Releases any held resources (e.g. stdin) so the process can exit naturally. Optional. */
  close?(): void;
}

// readline.Interface has no built-in masking option. The standard, well-documented trick is to
// temporarily override its private _writeToOutput — NOT to manage raw mode ourselves alongside
// it. An earlier version here did manual raw-mode stdin handling for the password prompt, which
// left stdin in a state where a *later* readline-based prompt (e.g. the OTP code, right after
// the password) never received further input — reproduced in isolation with piped input. Using
// readline exclusively, for every prompt, on one persistent interface avoids that entirely.
interface ReadlineInternal extends readline.Interface {
  _writeToOutput(stringToWrite: string): void;
}

export class ConsoleIO implements AuthIO {
  // Lazy — AmazonSession constructs a ConsoleIO by default even for commands that never prompt
  // anything (e.g. `match`). Creating the readline interface eagerly would hold stdin open and
  // hang the process after such a command finishes, for no reason.
  private rlInstance: readline.Interface | null = null;

  private rl(): readline.Interface {
    if (!this.rlInstance) {
      this.rlInstance = readline.createInterface({ input: process.stdin, output: process.stdout });
    }
    return this.rlInstance;
  }

  echo(msg: string): void {
    console.log(msg);
  }

  async prompt(msg: string, opts?: { choices?: string[] }): Promise<string> {
    for (const choice of opts?.choices ?? []) this.echo(choice);
    const rl = this.rl();
    return new Promise((resolve) => {
      rl.question(`--> ${msg}: `, (answer) => resolve(answer.trim()));
    });
  }

  async promptSecret(msg: string): Promise<string> {
    const rl = this.rl() as ReadlineInternal;
    const originalWrite = rl._writeToOutput.bind(rl);
    let masking = false;

    rl._writeToOutput = (stringToWrite: string) => {
      if (masking && stringToWrite !== '\r\n' && stringToWrite !== '\n') {
        originalWrite('*'.repeat(stringToWrite.length));
      } else {
        originalWrite(stringToWrite);
      }
    };

    return new Promise((resolve) => {
      // question() synchronously writes the label itself as its first action — start masking
      // only after issuing the call, so the label renders normally and just the keystrokes
      // that follow (asynchronously, once the user actually types) get masked.
      rl.question(`--> ${msg}: `, (answer) => {
        rl._writeToOutput = originalWrite;
        masking = false;
        resolve(answer.trim());
      });
      masking = true;
    });
  }

  /** Releases stdin so the process can exit naturally once all prompts are done. No-op if never used. */
  close(): void {
    this.rlInstance?.close();
    this.rlInstance = null;
  }
}
