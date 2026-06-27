import moo from "moo";

enum TT {
  WS = "WS",
  COMMENT = "comment",
  STRING = "string",
  LITERAL = "literal",
  OPEN = "open",
  CLOSE = "close",
  AMP = "amp",
  NL = "NL",
}

export namespace AST {
  export type File = {
    statements: Statement[];
  };
  export type Statement = Command;
  export type Command = {
    $: "command";
    name: string;
    args: (Command | StringLiteral)[];
    background: boolean;
  };
  export type StringLiteral = { $: "string"; value: string };
}

export class Parser {
  private _input: string = "";
  private _tokens: moo.Token[] = [];
  private _ptr = 0;

  lexer = moo.compile({
    [TT.WS]: /[ \t]+/,
    [TT.COMMENT]: /#.*?$/,
    [TT.STRING]: { match: /"(?:\\["\\]|[^\n"\\])*"/, value: (x) => JSON.parse(x) },
    [TT.LITERAL]: /[-a-zA-Z_0-9%,;'`/\\.]+/,
    [TT.OPEN]: "[",
    [TT.CLOSE]: "]",
    [TT.AMP]: "&",
    [TT.NL]: { match: /\n/, lineBreaks: true },
  });

  parse(input: string) {
    this._input = input;
    this._tokens = [...this.lexer.reset(this._input)];
    this._ptr = 0;

    return this._parse_file();
  }

  private eat() {
    for (;;) {
      const token = this._tokens[this._ptr++];
      if (!token) break;
      if (token.type === TT.WS || token.type === TT.COMMENT || token.type === TT.NL) continue;
      return token;
    }
  }

  private probe() {
    const prev = this._ptr;
    const token = this.eat();
    this._ptr = prev;
    return token;
  }

  private _error(token?: moo.Token, msg?: string) {
    return new Error(this.lexer.formatError(token, msg));
  }

  private _parse_file(): AST.File {
    const statements = [];

    while (this.probe()) {
      const stmt = this._parse_statement();
      if (!stmt) break;

      statements.push(stmt);
    }

    return {
      statements,
    };
  }

  private _parse_statement(): AST.Statement {
    const token = this.probe();
    if (!token) throw this._error(token, "Statement expected");

    if (token.type === TT.LITERAL) {
      return this._parse_command();
    }

    throw this._error(token, "Unexpected token");
  }

  private _parse_command(): AST.Command {
    const t_name = this.eat();
    if (!t_name || t_name.type !== TT.LITERAL) throw this._error(t_name, "Command name expected");

    const args: AST.Command["args"] = [];
    let background = false;

    for (;;) {
      const t_arg = this.probe();
      if (!t_arg) break;

      if (t_arg.type === TT.OPEN) {
        this.eat();
        args.push(this._parse_command());
        if (this.eat()?.type !== TT.CLOSE) throw this._error(t_arg, "Closing bracket expected");
      } else if (t_arg.type === TT.LITERAL) {
        args.push({ $: "string", value: t_arg.value });
        this.eat();
      } else if (t_arg.type === TT.STRING) {
        args.push({ $: "string", value: t_arg.value });
        this.eat();
      } else {
        break;
      }
    }

    if (this.probe()?.type === TT.AMP) {
      background = true;
      this.eat();
    }

    return { $: "command", name: t_name.value, args, background };
  }
}
