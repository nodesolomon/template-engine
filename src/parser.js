import Matcher from './matcher';
import Sink from './sink';

import {
  Bindvar,
  Comment,
  If,
  Inject,
  Macro,
  OrPredicate,
  Predicate,
  Repeated,
  Section,
  Text,
  Variable,
} from './instructions';

import {
  ALTERNATES_WITH,
  BINDVAR,
  END,
  EOF,
  IF,
  INJECT,
  MACRO,
  META_LEFT,
  META_RIGHT,
  NEWLINE,
  NOOP,
  OR_PREDICATE,
  PREDICATE,
  REPEATED,
  SECTION,
  SPACE,
  TAB,
} from './opcodes';

/**
 * Parse a template and send instructions to the given sink.
 */
class Parser {

  constructor(str, sink) {
    if (!(sink instanceof Sink)) {
      throw new Error('Argument "sink" must be a Sink instance.');
    }

    this.str = str;
    this.idx = 0;
    this.len = str.length;
    this.sink = sink;
    this.matcher = new Matcher(str);

    // TODO: currently no parse errors are emitted. Invalid instructions are
    // quietly emitted as text. May move error reporting to the sink class,
    // which would ensure that parse errors and compile errors are appended
    // to the same array.
    this.errors = [];
  }

  /**
   * Parse the input string, transitioning through the states.
   */
  parse() {
    this.idx = 0;
    let state = this.stateMain;
    while (state !== null) {
      state = state.call(this);
    }
    this.push(EOF);
  }

  push(inst) {
    this.sink.accept(inst);
  }

  parseTag(start, end) {
    // TODO: support preprocessor scoped instructions, e.g. {^.section foo}..{^.end}

    // A leading '#' indicates the start of a comment.
    if (this.str[start] === '#') {
      start++;
      this.push(new Comment(this.str.substring(start, end)), 0);
      return true;
    }

    const m = this.matcher;

    // If not the start of an instruction / predicate, it can only be a variable.
    if (this.str[start] !== '.') {
      m.set(start, end);
      return this.parseVariable();
    }

    return this.parseInstruction(start, end);
  }

  /*eslint complexity: ["error", 20]*/
  parseInstruction(start, end) {
    const m = this.matcher;

    // Set bounds of our low-level pattern matcher.
    start++;
    m.set(start, end);

    // If not the start of an instruction, it can only be a predicate.
    if (this.parsePredicate(PREDICATE)) {
      return true;
    }

    const op = m.matchInstruction();
    if (op === NOOP) {
      return false;
    }

    // Move past the instruction string.
    m.consume();

    // Parse the rest of the instruction.
    switch (op) {
    case ALTERNATES_WITH:
    case END:
    case EOF:
    case META_LEFT:
    case META_RIGHT:
    case NEWLINE:
    case SPACE:
    case TAB:
    {
      // Ensure there are no trailing characters.
      if (m.complete()) {
        this.push(op);
        return true;
      }
      return false;
    }

    case BINDVAR:
      return this.parseBindvar();

    case IF:
      return this.parseIf();

    case INJECT:
      return this.parseInject();

    case MACRO:
      return this.parseMacro();

    case OR_PREDICATE:
      return this.parsePredicate(OR_PREDICATE);

    case REPEATED:
    case SECTION:
      return this.parseSection(op);

    /* istanbul ignore next */
    default:
      throw new Error('Severe error, unknown instruction, most likely a parser bug.');
    }
  }

  /**
   * Parse a BINDVAR instruction. Example:
   *
   *   {.var @foo bar,baz|foo arg1 arg2|bar arg1}
   */
  parseBindvar() {
    const m = this.matcher;

    if (!m.matchSpace()) {
      return false;
    }
    m.consume();

    const definition = m.matchDefinition();
    if (definition === null) {
      return false;
    }
    m.consume();

    if (!m.matchSpace()) {
      return false;
    }
    m.consume();

    const variables = m.matchVariables();
    if (variables === null) {
      return false;
    }
    m.consume();

    const formatters = m.matchFormatters();
    if (formatters !== null) {
      m.consume();
    }

    if (!m.complete()) {
      return false;
    }

    this.push(new Bindvar(definition, variables, formatters === null ? 0 : formatters));
    return true;
  }

  /**
   * Parse an IF instruction. Example:
   *
   *   {.if foo || bar}
   */
  parseIf() {
    const m = this.matcher;

    if (!m.matchWhitespace()) {
      return false;
    }
    m.consume();

    // First check if this is a predicate expression. This method will parse and
    // push the predicate instruction and return true, or false if parse failed.
    if (this.parsePredicate(PREDICATE)) {
      return true;
    }

    // Otherwise look for a sequence of variables seperated by AND and OR operators.
    const expr = m.matchIfExpression();
    if (expr === null) {
      return false;
    }
    m.consume();

    if (!m.complete()) {
      return false;
    }

    this.push(new If(...expr));
    return true;
  }

  /**
   * Parse an INJECT instruction.  Example:
   *
   *   {.inject @bar ./messages-en_US.json}
   */
  parseInject() {
    const m = this.matcher;

    if (!m.matchSpace()) {
      return false;
    }
    m.consume();

    const definition = m.matchDefinition();
    if (definition === null) {
      return false;
    }
    m.consume();

    if (!m.matchSpace()) {
      return false;
    }
    m.consume();

    const path = m.matchFilePath();
    if (path === null) {
      return false;
    }
    m.consume();

    // Optional arguments which are parsed but currently ignored.
    // Note we do not skip spaces since the first space indicates
    // the delimiter.
    const args = m.matchArguments();
    if (args !== null) {
      m.consume();
    }

    if (!m.complete()) {
      return false;
    }

    this.push(new Inject(definition, path));
    return true;
  }

  /**
   * Parse a MACRO instruction. Example:
   *
   *   {.macro person-info}
   */
  parseMacro() {
    const m = this.matcher;

    if (!m.matchSpace()) {
      return false;
    }
    m.consume();

    const name = m.matchFilePath();
    if (name === null) {
      return false;
    }
    m.consume();

    if (!m.complete()) {
      return false;
    }

    this.push(new Macro(name));
    return true;
  }

  /**
   * Parse an OR_PREDICATE or PREDICATE instruction with arguments. Examples:
   *
   *   {.equal? foo "bar"}
   *   {.or}
   *   {.or greaterThan? year 2017}
   */
  parsePredicate(op) {
    const m = this.matcher;

    let space = false;
    if (op === OR_PREDICATE) {
      space = m.matchSpace();
      if (space) {
        m.consume();
      }
    }

    let name = null;
    let args = null;

    if (op === PREDICATE || space) {
      name = m.matchPredicate();
      if (name === null) {
        return false;
      }
      m.consume();

      args = m.matchArguments();
      if (args !== null) {
        m.consume();
      }
    }

    if (!m.complete()) {
      return false;
    }

    if (op === PREDICATE) {
      this.push(new Predicate(name, args === null ? 0 : args));
    } else {
      this.push(new OrPredicate(name === null ? 0 : name, args === null ? 0 : args));
    }
    return true;
  }

  /**
   * Parse a SECTION or REPEATED instruction. Examples:
   *
   *   {.section foo.bar}
   *   {.repeated section items}
   */
  parseSection(op) {
    const m = this.matcher;

    if (!m.matchWhitespace()) {
      return false;
    }
    m.consume();

    const variable = m.matchVariable();
    if (variable === null) {
      return false;
    }
    m.consume();

    if (!m.complete()) {
      return false;
    }

    if (op === REPEATED) {
      this.push(new Repeated(variable));
    } else {
      this.push(new Section(variable));
    }
    return true;
  }

  /**
   * Parse a variable reference and optional formatters. Examples:
   *
   *   {foo.bar}
   *   {items.0.name}
   *   {$foo.bar}
   *   {@baz}
   *
   *   {a, b, c|html|json-pretty}
   *   {timestamp|date %c}
   */
  parseVariable() {
    const m = this.matcher;

    const variables = m.matchVariables();
    if (variables === null) {
      return false;
    }
    m.consume();

    const formatters = m.matchFormatters();
    if (formatters !== null) {
      m.consume();
    }

    if (!m.complete()) {
      return false;
    }

    this.push(new Variable(variables, formatters === null ? 0 : formatters));
    return true;
  }

  /**
   * Flush characters between start and end as a text instruction and
   * set the stream pointer to the end.
   */
  flushText(start, end) {
    if (start < end) {
      const text = this.str.substring(start, end);
      this.push(new Text(text));
    }
    this.idx = end;
  }

  // STATES

  /**
   * Main parser state. Parses alternating text / code instructions.
   */
  stateMain() {
    const len = this.len;
    for (;;) {
      // Save the current position before we start scanning below.
      const save = this.idx;

      // Look for the start of a tag.
      let start = this.str.indexOf('{', save);

      // EOF searching for '{'
      if (start === -1) {
        this.flushText(save, len);
        return null;
      }

      // Check for start of a multi-line comment and process it.
      if (this.str[start + 1] === '#' && this.str[start + 2] === '#') {
        this.flushText(save, start);
        return this.stateMultiLineComment;
      }

      // Indicates whether the scanning loop below matched something.
      let matched = false;

      // Look for another '{' or the terminating '}'
      for (let i = start + 1; i < len; i++) {
        const ch = this.str[i];
        if (ch === '{') {
          // Found a further '{', move start of range to that position.
          start = i;

        } else if (ch === '}') {
          // Flush any intervening text.
          this.flushText(save, start);

          // Attempt to parse the tag. If this fails, we emit
          // the range as a text instruction.
          if (!this.parseTag(start + 1, i)) {
            this.flushText(start, i + 1);
          }

          // Update the pointer and indicate we matched something.
          this.idx = i + 1;
          matched = true;
          break;
        }
      }

      // EOF searching for '}'
      if (!matched) {
        this.flushText(save, len);
        return null;
      }
    }
  }

  /**
   * Multi-line comment parser state.
   */
  stateMultiLineComment() {
    // Skip '{##'
    this.idx += 3;
    const start = this.idx;
    const end = this.str.indexOf('##}', start);

    // The comment either stops at the matching end or EOF.
    const text = end === -1 ? this.str.substring(start) : this.str.substring(start, end);
    this.push(new Comment(text, true));

    // Bail if we hit EOF
    if (end === -1) {
      return null;
    }

    // If more characters, skip over '##}' and continue parsing.
    this.idx = end + 3;
    return this.stateMain;
  }

}

export default Parser;
