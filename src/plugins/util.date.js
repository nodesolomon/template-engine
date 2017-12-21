
const formats = {
  a: 'ddd',
  A: 'dddd',
  b: 'MMM',
  B: 'MMMM',
  C: { calc: 'century' },
  c: 'ddd, MMM DD, YYYY h:mm:ss A z',
  D: 'MM/DD/YY',
  d: 'DD',
  e: 'D',
  F: '%Y-%m-%d',
  g: 'GG',
  G: 'GGGG',
  H: 'HH',
  h: 'MMM',
  I: 'hh',
  j: 'DDDD',
  k: 'H',
  l: 'h',
  M: 'mm',
  m: 'MM',
  n: '\n',
  P: 'a',
  p: 'A',
  R: '%H:%M',
  r: '%I:%M:%S %p',
  S: 'ss',
  s: { calc: 'epoch-seconds' },
  T: '%H:%M:%S',
  t: '\t',
  U: '', // TODO: not supported directly in moment. %U range is 00-53, moment has no comparable field.
  u: 'E',
  V: 'WW',
  v: 'd',
  W: 'ww',
  w: 'd',
  x: 'MM/DD/YY',
  X: 'h:mm:ss a',
  Y: 'YYYY',
  y: 'YY',
  Z: 'z',
  z: 'ZZ',
};

/**
 * Translate a YUI / UNIX date format to MomentJS format.
 */
const translate = (fmt) => {
  let esc = '';
  const parts = [];
  const len = fmt.length;
  let i = 0;
  while (i < len) {
    let ch = fmt[i];

    // Skip '[' and ']'. MomentJS does not handle nesting these inside
    // escapes. All formatters should provide a way to include the
    // escape character as a literal.
    if (ch === '[' || ch === ']') {
      i++;
      continue;
    }

    // Any non-format sequence is appended to the current escape buffer.
    if (ch !== '%') {
      esc += ch;
      i++;
      continue;
    }

    // Examine char after '%'. If we're at end, escape it and bail.
    i++;
    if (i === len) {
      esc += ch;
      break;
    }

    ch = fmt[i];

    // Escaped escape.
    if (ch === '%') {
      esc += ch;
      i++;
      continue;
    }

    // Push any escaped characters we accumulated.
    const hasEscape = esc.length > 0;
    if (hasEscape) {
      parts.push('[' + esc + ']');
      esc = '';
    }

    const replacement = formats[ch];
    if (replacement) {
      if (parts.length > 0 && !hasEscape) {
        // Detect when two MomentJS formats will be concatenated and
        // separate them with an empty escape. This avoids cases where
        // formats might introduce ambiguity, e.g. '%y%Y' => 'YYYYYY'.
        parts.push('[]');
      }
      parts.push(replacement);
    }

    i++;
  }

  // Append any trailing escape characters.
  if (esc.length > 0) {
    parts.push('[' + esc + ']');
  }

  return parts;
};

export default {
  translate,
};