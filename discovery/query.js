(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js'));
  else root.RadioAppleDiscovery.query = factory(root.RadioAppleDiscovery.model);
})(globalThis, function (model) {
  'use strict';

  const { TAG_TYPES, normalizeText, integer } = model;
  const operators = new Map([['AND', 'and'], ['OR', 'or'], ['||', 'or'], ['NOT', 'not']]);

  function analyze(text) {
    return normalizeText(text).match(/[\p{L}\p{M}\p{N}_]+(?:['’][\p{L}\p{M}\p{N}_]+)*|[/&]/gu) ?? [];
  }

  class QueryError extends Error {
    constructor(code, message, offset) {
      super(message);
      this.code = code;
      this.offset = offset;
    }
  }

  function term(value, quoted, offset) {
    const wildcard = value.endsWith('*') && !quoted;
    const literal = wildcard ? value.slice(0, -1) : value;
    const words = analyze(literal);
    if (literal.includes('*') || (wildcard && !/^[\p{L}\p{M}\p{N}_]+$/u.test(literal))) {
      throw new QueryError('invalid-wildcard', 'Use one trailing * after a word prefix.', offset);
    }
    if (!words.some(word => /[\p{L}\p{N}_]/u.test(word)) && value !== '&') {
      throw new QueryError('empty-term', 'Enter a word or phrase to search for.', offset);
    }
    return { kind: 'term', words, wildcard };
  }

  function tokenize(input) {
    const tokens = [];
    let i = 0;
    while (i < input.length) {
      const offset = i;
      const char = input[i];
      if (/\s/u.test(char)) {
        i++;
      } else if (char === '(' || char === ')' || char === '-') {
        tokens.push({ kind: char === '-' ? 'not' : char, offset });
        i++;
      } else if (input.startsWith('||', i)) {
        tokens.push({ kind: 'or', offset });
        i += 2;
      } else if (char === '"') {
        const phrase = /^"((?:[^"\\]|\\["\\])*)"/.exec(input.slice(i));
        if (!phrase) throw new QueryError('invalid-phrase', 'Close the quoted phrase and escape quotes with \\".', offset);
        tokens.push({ ...term(phrase[1].replace(/\\(["\\])/g, '$1'), true, offset), offset });
        i += phrase[0].length;
      } else {
        const value = /^[^\s()"|]+/u.exec(input.slice(i))?.[0];
        if (!value || /[:@?~^+!\\[\]{}<>]|&&/.test(value)) {
          throw new QueryError('unsupported-syntax', 'Use words, phrases, AND, OR, exclusions, or structured filters.', offset);
        }
        tokens.push(operators.has(value) ? { kind: operators.get(value), offset } : { ...term(value, false, offset), offset });
        i += value.length;
      }
    }
    return tokens;
  }

  function parseQuery(input) {
    if (typeof input !== 'string' || input.length > 1024) {
      return { ast: null, errors: [{ code: 'invalid-query-length', message: 'Enter a query of up to 1024 characters.', offset: 0 }] };
    }
    let i = 0;
    try {
      const tokens = tokenize(input);
      const peek = () => tokens[i]?.kind;
      const error = message => new QueryError('invalid-expression', message, tokens[i]?.offset ?? input.length);
      const combine = (kind, parts) => parts.length === 1 ? parts[0] : { kind, parts };

      function atom(depth) {
        const token = tokens[i];
        if (peek() === 'term') {
          i++;
          return token;
        }
        if (peek() !== '(') throw error('Expected a word, phrase, or parenthesized expression.');
        if (depth >= 12) throw error('Use at most 12 levels of parentheses.');
        i++;
        const node = expression(depth + 1);
        if (peek() !== ')') throw error('Close the parenthesized expression.');
        i++;
        return { kind: 'group', node };
      }

      function expression(depth) {
        const exclusions = [];
        function adjacent() {
          const terms = [];
          const groups = [];
          do {
            if (peek() === 'not') {
              i++;
              exclusions.push({ kind: 'not', node: atom(depth) });
            } else {
              const node = atom(depth);
              if (node.kind === 'term') terms.push(node);
              else groups.push(node);
            }
          } while (['term', '(', 'not'].includes(peek()));
          if (terms.length) groups.unshift({ kind: 'field', terms });
          return groups.length ? combine('and', groups) : null;
        }
        function conjunction() {
          const parts = [adjacent()];
          while (peek() === 'and') {
            i++;
            parts.push(adjacent());
          }
          const positive = parts.filter(Boolean);
          return positive.length ? combine('and', positive) : null;
        }
        const alternatives = [conjunction()];
        while (peek() === 'or') {
          if (!alternatives.at(-1)) throw error('OR requires positive operands. Group an exclusion to use it as a branch.');
          i++;
          alternatives.push(conjunction());
          if (!alternatives.at(-1)) throw error('OR requires positive operands. Group an exclusion to use it as a branch.');
        }
        const positive = alternatives[0] ? [combine('or', alternatives)] : [];
        return combine('and', [...positive, ...exclusions]);
      }

      const ast = tokens.length ? expression(0) : null;
      if (i !== tokens.length) throw error('Unexpected closing parenthesis or operator.');
      return { ast, errors: [] };
    } catch (problem) {
      if (!(problem instanceof QueryError)) throw problem;
      return { ast: null, errors: [{ code: problem.code, message: problem.message, offset: problem.offset }] };
    }
  }

  function textIndex(values) {
    const text = values.map(value => analyze(value).join(' ')).filter(Boolean).join('  ');
    return text ? ` ${text} ` : '';
  }

  function indexText(work, filterNames) {
    const originalTags = TAG_TYPES.flatMap(type => type === 'rating' ? (work.rating ? [work.rating] : []) : (work[type] ?? []));
    return {
      title: textIndex([work.title]),
      creator: textIndex([work.author, ...(work.creators ?? []).map(creator => creator.name)]),
      tags: textIndex([...new Set([...originalTags, ...filterNames])]),
      summary: textIndex([work.summary]),
      series: textIndex((work.series ?? []).map(series => series.title))
    };
  }

  const weights = { title: 7, creator: 5, tags: 1, summary: 1, series: 1 };

  function compileQuery(ast, field) {
    const fields = field ? [field] : Object.keys(weights);
    function matches({ words, wildcard }) {
      if (wildcard) {
        const prefix = new RegExp(` ${words[0]}[^ ]* `, 'u');
        return value => prefix.test(value);
      }
      const phrase = ` ${words.join(' ')} `;
      return value => value.includes(phrase);
    }
    function compile(node) {
      if (!node) return () => 0;
      if (node.kind === 'field' || node.kind === 'term') {
        const tests = (node.terms ?? [node]).map(matches);
        return index => {
          let best = null;
          for (const fieldName of fields) {
            if (tests.every(test => test(index[fieldName]))) best = Math.max(best ?? 0, weights[fieldName] * tests.length);
          }
          return best;
        };
      }
      if (node.kind === 'group') return compile(node.node);
      if (node.kind === 'not') {
        const evaluate = compile(node.node);
        return index => evaluate(index) === null ? 0 : null;
      }
      const clauses = node.parts.map(compile);
      return index => {
        let score = null;
        for (const clause of clauses) {
          const result = clause(index);
          if (result === null && node.kind === 'and') return null;
          if (result !== null) score = (score ?? 0) + result;
        }
        return score;
      };
    }
    return compile(ast);
  }

  function parseNumberRange(input) {
    const text = typeof input === 'string' ? input.trim() : '';
    if (!text && typeof input === 'string') return { range: null, errors: [] };
    const match = /^([<>])?\s*([0-9](?:[0-9]|[.,](?=[0-9]))*)(?:\s*-\s*([0-9](?:[0-9]|[.,](?=[0-9]))*))?$/.exec(text);
    const lower = match ? integer(match[2].replace(/[.,]/g, '')) : null;
    const upper = match?.[3] ? integer(match[3].replace(/[.,]/g, '')) : null;
    if (lower === null || (match[3] && (match[1] || upper === null || upper < lower))) {
      return { range: null, errors: [{ code: 'invalid-number-range', message: 'Use a number, <number, >number, or min-max.' }] };
    }
    return { range: upper !== null ? { min: lower, max: upper }
      : { [match[1] === '<' ? 'lt' : match[1] === '>' ? 'gt' : 'eq']: lower }, errors: [] };
  }

  return { parseQuery, compileQuery, indexText, parseNumberRange };
});
