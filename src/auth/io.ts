import * as readline from 'node:readline';

export interface AuthIO {
  echo(msg: string): void;
  prompt(msg: string, opts?: { choices?: string[] }): Promise<string>;
  /** Like prompt(), but must not echo the typed characters back to the terminal. */
  promptSecret(msg: string): Promise<string>;
}

/** Masks input by intercepting the terminal's write stream — no extra dependency needed. */
function readSecret(rl: readline.Interface, query: string): Promise<string> {
  const output = process.stdout;
  return new Promise((resolve) => {
    const onData = (char: Buffer) => {
      const c = char.toString();
      // Ctrl+C / Ctrl+D still terminate normally; readline handles those itself.
      if (c === '\n' || c === '\r' || c === '') return;
      output.write('*'); // backspace over the echoed char, print a mask instead
    };
    process.stdin.on('data', onData);
    rl.question(query, (answer) => {
      process.stdin.removeListener('data', onData);
      output.write('\n');
      resolve(answer);
    });
  });
}

/** Default console-based IO — used by the CLI. Never persists or logs the password. */
export class ConsoleIO implements AuthIO {
  private rl(): readline.Interface {
    return readline.createInterface({ input: process.stdin, output: process.stdout });
  }

  echo(msg: string): void {
    console.log(msg);
  }

  async prompt(msg: string, opts?: { choices?: string[] }): Promise<string> {
    for (const choice of opts?.choices ?? []) this.echo(choice);
    const rl = this.rl();
    return new Promise((resolve) => {
      rl.question(`--> ${msg}: `, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  async promptSecret(msg: string): Promise<string> {
    const rl = this.rl();
    try {
      const answer = await readSecret(rl, `--> ${msg}: `);
      return answer.trim();
    } finally {
      rl.close();
    }
  }
}
