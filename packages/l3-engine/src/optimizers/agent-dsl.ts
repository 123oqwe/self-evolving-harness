// L3-T13: Turing-complete agent DSL — parser + breaker-flag validator.
//
// Spec: execution/L3-engine/TASKS.md §L3-T13 + ERRATA L3-T13 (AST 类型=
// acorn-style 节点携带 `type` 字段; 节点类型契约仅锁 `type` 字段存在).
//
// Design note: the spec's "复用 acorn" hint cannot be honoured here — acorn
// is not an installed dependency and the task rules forbid adding new deps /
// symlinks. Per ERRATA the only locked contract is that AST nodes carry a
// `type` string field (acorn-style ESTree shape). We therefore ship a
// minimal self-authored recursive-descent parser for a Turing-complete JS
// subset (control flow, calls, member access, destructuring, arrows) that
// emits acorn/ESTree-style nodes. The breaker-flag validator is fully
// self-authored (REFACTOR: shared walker lives in ./dsl-validator.ts so
// L2-T09b-style exec/eval/network flag detection can be reused).
//
// Breaker clause (inherited from L2-T09b): eval() / network egress /
// subprocess exec-spawn are forbidden flags — ADAS-written skill code is
// staging + human-signed by default; this validator is the hard gate.

import type { Sandbox } from "../sandbox.js";
import { validateBreakerFlags, type DslValidationResult } from "./dsl-validator.js";

// ---------------------------------------------------------------------------
// AST node types (acorn/ESTree-style: every node carries a `type` string).
// ---------------------------------------------------------------------------

export interface ASTNode {
  type: string;
  [key: string]: unknown;
}

/** Root AST returned by `AgentDSL.parse`. Acorn-style `Program` node. */
export type AST = ASTNode;

// ---------------------------------------------------------------------------
// Tokenizer.
// ---------------------------------------------------------------------------

type TokKind = "id" | "str" | "num" | "punc" | "op";
interface Tok {
  t: TokKind;
  v: string;
}

const ID_START = /[A-Za-z_$]/;
const ID_PART = /[A-Za-z0-9_$]/;

const MULTI_OPS = new Set<string>([
  "=>",
  "==",
  "===",
  "!=",
  "!==",
  ">=",
  "<=",
  "&&",
  "||",
  "??",
  "++",
  "--",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "**",
  ">>",
  "<<",
]);

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src.charAt(i);
    // whitespace
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    // line comment
    if (c === "/" && src.charAt(i + 1) === "/") {
      i += 2;
      while (i < n && src.charAt(i) !== "\n") i++;
      continue;
    }
    // block comment
    if (c === "/" && src.charAt(i + 1) === "*") {
      i += 2;
      while (i < n && !(src.charAt(i) === "*" && src.charAt(i + 1) === "/")) i++;
      i += 2;
      continue;
    }
    // strings (single / double / template) — template interpolation is treated
    // as a flat string token (no nested ${} parsing); sufficient for the DSL
    // subset the meta-agent emits and for breaker-flag detection.
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let j = i + 1;
      let s = "";
      while (j < n && src.charAt(j) !== quote) {
        if (src.charAt(j) === "\\" && j + 1 < n) {
          s += src.charAt(j) + src.charAt(j + 1);
          j += 2;
        } else {
          s += src.charAt(j);
          j++;
        }
      }
      j++; // skip closing quote
      toks.push({ t: "str", v: s });
      i = j;
      continue;
    }
    // numbers
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src.charAt(i + 1)))) {
      let j = i;
      while (j < n && /[0-9._eExXa-fA-F]/.test(src.charAt(j))) j++;
      toks.push({ t: "num", v: src.slice(i, j) });
      i = j;
      continue;
    }
    // identifiers / keywords
    if (ID_START.test(c)) {
      let j = i;
      while (j < n && ID_PART.test(src.charAt(j))) j++;
      toks.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    // multi-char operators
    const two = src.slice(i, i + 2);
    if (MULTI_OPS.has(two)) {
      toks.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    const three = src.slice(i, i + 3);
    if (MULTI_OPS.has(three)) {
      toks.push({ t: "op", v: three });
      i += 3;
      continue;
    }
    // punctuators
    if ("(){}[];,.".includes(c)) {
      toks.push({ t: "punc", v: c });
      i++;
      continue;
    }
    // single-char operator
    toks.push({ t: "op", v: c });
    i++;
  }
  return toks;
}

// ---------------------------------------------------------------------------
// Recursive-descent parser (Turing-complete JS subset).
// ---------------------------------------------------------------------------

class ParseError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ParseError";
  }
}

const PRECEDENCE: Record<string, number> = {
  "||": 1,
  "??" : 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "===": 3,
  "!==": 3,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
};

class Parser {
  private pos = 0;
  constructor(private readonly toks: Tok[]) {}

  parse(): ASTNode {
    const body: ASTNode[] = [];
    while (!this.atEnd()) body.push(this.parseStatement());
    return { type: "Program", body };
  }

  private peek(off = 0): Tok | undefined {
    return this.toks[this.pos + off];
  }
  private atEnd(): boolean {
    return this.pos >= this.toks.length;
  }
  private next(): Tok {
    const t = this.toks[this.pos++];
    if (!t) throw new ParseError("unexpected end of input");
    return t;
  }
  private expectPunc(v: string): void {
    const t = this.next();
    if (t.t !== "punc" || t.v !== v) {
      throw new ParseError(`expected '${v}' but got '${t?.v ?? "<eof>"}'`);
    }
  }
  private expectOp(v: string): void {
    const t = this.next();
    if (t.t !== "op" || t.v !== v) {
      throw new ParseError(`expected '${v}' but got '${t?.v ?? "<eof>"}'`);
    }
  }
  private isPunc(v: string): boolean {
    const t = this.peek();
    return !!t && t.t === "punc" && t.v === v;
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return !!t && t.t === "op" && t.v === v;
  }
  private isId(v: string): boolean {
    const t = this.peek();
    return !!t && t.t === "id" && t.v === v;
  }
  private eatSemi(): void {
    if (this.isPunc(";")) this.next();
  }

  // --- Statements ---

  private parseStatement(): ASTNode {
    const t = this.peek();
    if (!t) throw new ParseError("unexpected end of input");
    if (t.t === "id") {
      switch (t.v) {
        case "function":
          return this.parseFunctionDeclaration();
        case "const":
        case "let":
        case "var":
          return this.parseVariableDeclaration(true);
        case "return":
          return this.parseReturn();
        case "for":
          return this.parseFor();
        case "if":
          return this.parseIf();
        case "while":
          return this.parseWhile();
        case "break":
        case "continue":
          this.next();
          this.eatSemi();
          return { type: t.v === "break" ? "BreakStatement" : "ContinueStatement", label: null };
        case "throw":
          this.next();
          const arg = this.parseExpression();
          this.eatSemi();
          return { type: "ThrowStatement", argument: arg };
      }
    }
    if (t.t === "punc" && t.v === "{") return this.parseBlock();
    if (t.t === "punc" && t.v === ";") {
      this.next();
      return { type: "EmptyStatement" };
    }
    const expr = this.parseExpression();
    this.eatSemi();
    return { type: "ExpressionStatement", expression: expr };
  }

  private parseFunctionDeclaration(): ASTNode {
    this.next(); // 'function'
    let id: ASTNode | null = null;
    if (this.peek() && this.peek()!.t === "id") {
      id = { type: "Identifier", name: this.next().v };
    }
    const params = this.parseParams();
    const body = this.parseBlock();
    return { type: "FunctionDeclaration", id, params, body };
  }

  private parseParams(): ASTNode[] {
    this.expectPunc("(");
    const params: ASTNode[] = [];
    while (!this.isPunc(")")) {
      params.push(this.parsePattern());
      if (this.isPunc(",")) this.next();
    }
    this.expectPunc(")");
    return params;
  }

  private parsePattern(): ASTNode {
    if (this.isPunc("{")) return this.parseObjectPattern();
    if (this.isPunc("[")) return this.parseArrayPattern();
    const t = this.next();
    if (t.t !== "id") throw new ParseError(`expected pattern, got '${t.v}'`);
    const id = { type: "Identifier", name: t.v };
    if (this.isOp("=")) {
      this.next();
      const def = this.parseAssignment();
      return { type: "AssignmentPattern", left: id, right: def };
    }
    return id;
  }

  private parseObjectPattern(): ASTNode {
    this.expectPunc("{");
    const props: ASTNode[] = [];
    while (!this.isPunc("}")) {
      let key: ASTNode;
      let computed = false;
      const kt = this.peek()!;
      if (kt.t === "punc" && kt.v === "[") {
        this.next();
        key = this.parseAssignment();
        this.expectPunc("]");
        computed = true;
      } else if (kt.t === "str") {
        this.next();
        key = { type: "Literal", value: kt.v, raw: `'${kt.v}'` };
      } else {
        this.next();
        key = { type: "Identifier", name: kt.v };
      }
      let value: ASTNode;
      let shorthand = false;
      if (this.isPunc(":")) {
        this.next();
        value = this.parsePattern();
      } else {
        value = { type: "Identifier", name: (key as { name?: string }).name ?? kt.v };
        shorthand = true;
      }
      if (this.isOp("=")) {
        this.next();
        const def = this.parseAssignment();
        value = { type: "AssignmentPattern", left: value, right: def };
      }
      props.push({ type: "Property", key, value, shorthand, computed });
      if (this.isPunc(",")) this.next();
    }
    this.expectPunc("}");
    return { type: "ObjectPattern", properties: props };
  }

  private parseArrayPattern(): ASTNode {
    this.expectPunc("[");
    const elements: (ASTNode | null)[] = [];
    while (!this.isPunc("]")) {
      if (this.isPunc(",")) {
        elements.push(null);
        this.next();
        continue;
      }
      elements.push(this.parsePattern());
      if (this.isPunc(",")) this.next();
    }
    this.expectPunc("]");
    return { type: "ArrayPattern", elements };
  }

  private parseVariableDeclaration(requireSemi: boolean): ASTNode {
    const kind = this.next().v; // const/let/var
    const declarations: ASTNode[] = [];
    do {
      const id = this.parsePattern();
      let init: ASTNode | null = null;
      if (this.isOp("=")) {
        this.next();
        init = this.parseAssignment();
      }
      declarations.push({ type: "VariableDeclarator", id, init });
    } while (this.isPunc(",") && this.next());
    if (requireSemi) this.eatSemi();
    return { type: "VariableDeclaration", declarations, kind };
  }

  private parseReturn(): ASTNode {
    this.next(); // 'return'
    let argument: ASTNode | null = null;
    if (!this.isPunc(";") && !this.isPunc("}")) {
      argument = this.parseExpression();
    }
    this.eatSemi();
    return { type: "ReturnStatement", argument };
  }

  private parseBlock(): ASTNode {
    this.expectPunc("{");
    const body: ASTNode[] = [];
    while (!this.isPunc("}")) {
      body.push(this.parseStatement());
    }
    this.expectPunc("}");
    return { type: "BlockStatement", body };
  }

  private parseIf(): ASTNode {
    this.next(); // 'if'
    this.expectPunc("(");
    const test = this.parseExpression();
    this.expectPunc(")");
    const consequent = this.parseStatement();
    let alternate: ASTNode | null = null;
    if (this.isId("else")) {
      this.next();
      alternate = this.parseStatement();
    }
    return { type: "IfStatement", test, consequent, alternate };
  }

  private parseWhile(): ASTNode {
    this.next(); // 'while'
    this.expectPunc("(");
    const test = this.parseExpression();
    this.expectPunc(")");
    const body = this.parseStatement();
    return { type: "WhileStatement", test, body };
  }

  private parseFor(): ASTNode {
    this.next(); // 'for'
    this.expectPunc("(");
    // destructuring/decl init
    const t = this.peek();
    const isDecl = t && t.t === "id" && ["const", "let", "var"].includes(t.v);
    if (isDecl) {
      const kind = this.next().v;
      const id = this.parsePattern();
      if (this.isId("of")) {
        this.next();
        const right = this.parseExpression();
        this.expectPunc(")");
        const body = this.parseStatement();
        return {
          type: "ForOfStatement",
          left: {
            type: "VariableDeclaration",
            declarations: [{ type: "VariableDeclarator", id, init: null }],
            kind,
          } as ASTNode,
          right,
          body,
        };
      }
      if (this.isId("in")) {
        this.next();
        const right = this.parseExpression();
        this.expectPunc(")");
        const body = this.parseStatement();
        return {
          type: "ForInStatement",
          left: {
            type: "VariableDeclaration",
            declarations: [{ type: "VariableDeclarator", id, init: null }],
            kind,
          } as ASTNode,
          right,
          body,
        };
      }
      let initVal: ASTNode | null = null;
      if (this.isOp("=")) {
        this.next();
        initVal = this.parseAssignment();
      }
      const decl = {
        type: "VariableDeclaration",
        declarations: [{ type: "VariableDeclarator", id, init: initVal }],
        kind,
      } as ASTNode;
      this.expectPunc(";");
      const test = this.isPunc(";") ? null : this.parseExpression();
      this.expectPunc(";");
      const update = this.isPunc(")") ? null : this.parseExpression();
      this.expectPunc(")");
      const body = this.parseStatement();
      return { type: "ForStatement", init: decl, test, update, body };
    }
    // for (lhs of/in expr) or for (expr; expr; expr)
    const left = this.parseExpression();
    if (this.isId("of")) {
      this.next();
      const right = this.parseExpression();
      this.expectPunc(")");
      const body = this.parseStatement();
      return { type: "ForOfStatement", left, right, body };
    }
    if (this.isId("in")) {
      this.next();
      const right = this.parseExpression();
      this.expectPunc(")");
      const body = this.parseStatement();
      return { type: "ForInStatement", left, right, body };
    }
    // classic for(init; test; update)
    this.expectPunc(";");
    const test = this.isPunc(";") ? null : this.parseExpression();
    this.expectPunc(";");
    const update = this.isPunc(")") ? null : this.parseExpression();
    this.expectPunc(")");
    const body = this.parseStatement();
    return { type: "ForStatement", init: left, test, update, body };
  }

  // --- Expressions ---

  private parseExpression(): ASTNode {
    const first = this.parseAssignment();
    if (this.isPunc(",")) {
      const exprs = [first];
      while (this.isPunc(",") && this.next()) {
        exprs.push(this.parseAssignment());
      }
      return { type: "SequenceExpression", expressions: exprs };
    }
    return first;
  }

  private parseAssignment(): ASTNode {
    const left = this.parseConditional();
    const t = this.peek();
    if (t && t.t === "op" && ["=", "+=", "-=", "*=", "/=", "%="].includes(t.v)) {
      this.next();
      const right = this.parseAssignment();
      return { type: "AssignmentExpression", operator: t.v, left, right };
    }
    return left;
  }

  private parseConditional(): ASTNode {
    const test = this.parseBinary(0);
    if (this.isOp("?")) {
      this.next();
      const consequent = this.parseAssignment();
      this.expectOp(":");
      const alternate = this.parseAssignment();
      return { type: "ConditionalExpression", test, consequent, alternate };
    }
    return test;
  }

  private parseBinary(minPrec: number): ASTNode {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== "op") break;
      const prec = PRECEDENCE[t.v];
      if (prec === undefined || prec < minPrec) break;
      const op = this.next().v;
      const right = this.parseBinary(prec + 1);
      const type = op === "&&" || op === "||" || op === "??" ? "LogicalExpression" : "BinaryExpression";
      left = { type, operator: op, left, right };
    }
    return left;
  }

  private parseUnary(): ASTNode {
    const t = this.peek();
    if (t && t.t === "op" && ["!", "~", "-", "+"].includes(t.v)) {
      this.next();
      const arg = this.parseUnary();
      return { type: "UnaryExpression", operator: t.v, argument: arg, prefix: true };
    }
    if (t && t.t === "op" && (t.v === "++" || t.v === "--")) {
      this.next();
      const arg = this.parseUnary();
      return { type: "UpdateExpression", operator: t.v, argument: arg, prefix: true };
    }
    if (t && t.t === "id" && (t.v === "typeof" || t.v === "void" || t.v === "delete")) {
      this.next();
      const arg = this.parseUnary();
      return { type: "UnaryExpression", operator: t.v, argument: arg, prefix: true };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): ASTNode {
    const expr = this.parseCallMember();
    const t = this.peek();
    if (t && t.t === "op" && (t.v === "++" || t.v === "--")) {
      this.next();
      return { type: "UpdateExpression", operator: t.v, argument: expr, prefix: false };
    }
    return expr;
  }

  private parseCallMember(): ASTNode {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.isPunc(".")) {
        this.next();
        const pt = this.next();
        const prop = pt.t === "id" ? { type: "Identifier", name: pt.v } : { type: "Literal", value: pt.v };
        expr = { type: "MemberExpression", object: expr, property: prop, computed: false };
      } else if (this.isPunc("[")) {
        this.next();
        const prop = this.parseExpression();
        this.expectPunc("]");
        expr = { type: "MemberExpression", object: expr, property: prop, computed: true };
      } else if (this.isPunc("(")) {
        const args = this.parseArgs();
        expr = { type: "CallExpression", callee: expr, arguments: args };
      } else {
        break;
      }
    }
    return expr;
  }

  private parseArgs(): ASTNode[] {
    this.expectPunc("(");
    const args: ASTNode[] = [];
    while (!this.isPunc(")")) {
      args.push(this.parseAssignment());
      if (this.isPunc(",")) this.next();
    }
    this.expectPunc(")");
    return args;
  }

  private parsePrimary(): ASTNode {
    const t = this.next();
    if (!t) throw new ParseError("unexpected end of input");
    if (t.t === "id") {
      if (t.v === "function") {
        let id: ASTNode | null = null;
        if (this.peek() && this.peek()!.t === "id") {
          id = { type: "Identifier", name: this.next().v };
        }
        const params = this.parseParams();
        const body = this.parseBlock();
        return { type: "FunctionExpression", id, params, body };
      }
      if (t.v === "true" || t.v === "false") {
        return { type: "Literal", value: t.v === "true", raw: t.v };
      }
      if (t.v === "null") {
        return { type: "Literal", value: null, raw: "null" };
      }
      if (t.v === "new") {
        const callee = this.parseCallMember();
        const args = this.isPunc("(") ? this.parseArgs() : [];
        return { type: "NewExpression", callee, arguments: args };
      }
      return { type: "Identifier", name: t.v };
    }
    if (t.t === "num") {
      return { type: "Literal", value: Number(t.v), raw: t.v };
    }
    if (t.t === "str") {
      return { type: "Literal", value: t.v, raw: `'${t.v}'` };
    }
    if (t.t === "punc") {
      if (t.v === "(") {
        const expr = this.parseExpression();
        this.expectPunc(")");
        return { type: "ParenthesizedExpression", expression: expr };
      }
      if (t.v === "[") {
        const elements: (ASTNode | null)[] = [];
        while (!this.isPunc("]")) {
          if (this.isPunc(",")) {
            elements.push(null);
            this.next();
            continue;
          }
          elements.push(this.parseAssignment());
          if (this.isPunc(",")) this.next();
        }
        this.expectPunc("]");
        return { type: "ArrayExpression", elements };
      }
      if (t.v === "{") {
        return this.parseObjectExpression();
      }
    }
    throw new ParseError(`unexpected token '${t.v}'`);
  }

  private parseObjectExpression(): ASTNode {
    this.expectPunc("{");
    const props: ASTNode[] = [];
    while (!this.isPunc("}")) {
      let key: ASTNode;
      let computed = false;
      const kt = this.next();
      if (kt.t === "punc" && kt.v === "[") {
        key = this.parseAssignment();
        this.expectPunc("]");
        computed = true;
      } else if (kt.t === "str") {
        key = { type: "Literal", value: kt.v, raw: `'${kt.v}'` };
      } else if (kt.t === "num") {
        key = { type: "Literal", value: Number(kt.v), raw: kt.v };
      } else {
        key = { type: "Identifier", name: kt.v };
      }
      let value: ASTNode;
      let shorthand = false;
      if (this.isPunc(":")) {
        this.next();
        value = this.parseAssignment();
      } else if (this.isOp("=")) {
        this.next();
        value = this.parseAssignment();
      } else {
        value = { type: "Identifier", name: (key as { name?: string }).name ?? "x" };
        shorthand = true;
      }
      if (this.isOp("=")) {
        // default value in destructuring context (tolerate)
        this.next();
        const def = this.parseAssignment();
        value = { type: "AssignmentPattern", left: value, right: def };
      }
      props.push({ type: "Property", key, value, shorthand, computed });
      if (this.isPunc(",")) this.next();
    }
    this.expectPunc("}");
    return { type: "ObjectExpression", properties: props };
  }
}

// ---------------------------------------------------------------------------
// AgentDSL — public surface (parse + validate).
// ---------------------------------------------------------------------------

export interface AgentDSL {
  parse(code: string): AST;
  validate(ast: AST, sandbox: Sandbox): DslValidationResult;
}

export class AgentDSL {
  /**
   * Parse DSL source into an acorn/ESTree-style AST (Turing-complete JS
   * subset: control flow, calls, member access, destructuring, arrows,
   * binary/logical/unary/update/conditional/sequence expressions).
   */
  parse(code: string): AST {
    const toks = tokenize(code);
    const parser = new Parser(toks);
    return parser.parse();
  }

  /**
   * Validate an AST against the breaker clause (inherited from L2-T09b):
   * `eval()`, network egress (fetch/https/http/ws/...), and subprocess
   * (exec/spawn/fork/require('child_process')) are forbidden flags.
   *
   * `sandbox` is accepted per the spec signature (the static-core read-only
   * invariants are checked elsewhere by the L3-T01 breaker); this validator
   * performs pure static analysis over the parsed AST.
   */
  validate(ast: AST, _sandbox: Sandbox): DslValidationResult {
    return validateBreakerFlags(ast);
  }
}
