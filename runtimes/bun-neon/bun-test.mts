import {
  after as afterAll,
  afterEach,
  before as beforeAll,
  beforeEach,
  describe,
  it,
  test,
} from 'node:test';
import { inspect, isDeepStrictEqual } from 'node:util';

export { afterAll, afterEach, beforeAll, beforeEach, describe, it, test };

export interface Matchers<T> {
  readonly not: Matchers<T>;
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toStrictEqual(expected: unknown): void;
  toContain(expected: unknown): void;
  toMatch(pattern: string | RegExp): void;
  toThrow(expected?: string | RegExp | Error | (new (...args: unknown[]) => Error)): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toBeDefined(): void;
  toHaveLength(expected: number): void;
  toBeGreaterThan(expected: number | bigint): void;
  toBeLessThan(expected: number | bigint): void;
  toBeInstanceOf(ctor: abstract new (...args: never[]) => unknown): void;
}

class AssertionFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

function fmt(val: unknown): string {
  return inspect(val, { depth: 4, colors: false });
}

function createMatchers<T>(actual: T, negated: boolean): Matchers<T> {
  const check = (pass: boolean, message: string, negatedMessage: string): void => {
    if (negated ? pass : !pass) {
      throw new AssertionFailure(negated ? negatedMessage : message);
    }
  };

  const matchers: Matchers<T> = {
    get not(): Matchers<T> {
      return createMatchers(actual, !negated);
    },

    toBe(expected: unknown): void {
      check(
        Object.is(actual, expected),
        `Expected ${fmt(actual)} to be ${fmt(expected)}`,
        `Expected ${fmt(actual)} not to be ${fmt(expected)}`,
      );
    },

    toEqual(expected: unknown): void {
      check(
        isDeepStrictEqual(actual, expected),
        `Expected ${fmt(actual)} to equal ${fmt(expected)}`,
        `Expected ${fmt(actual)} not to equal ${fmt(expected)}`,
      );
    },

    toStrictEqual(expected: unknown): void {
      check(
        isDeepStrictEqual(actual, expected),
        `Expected ${fmt(actual)} to strictly equal ${fmt(expected)}`,
        `Expected ${fmt(actual)} not to strictly equal ${fmt(expected)}`,
      );
    },

    toContain(expected: unknown): void {
      let contains = false;
      if (typeof actual === 'string') {
        contains = actual.includes(String(expected));
      } else if (Array.isArray(actual)) {
        contains = actual.includes(expected);
      } else if (actual instanceof Set) {
        contains = actual.has(expected);
      } else if (actual !== null && typeof actual === 'object' && Symbol.iterator in actual) {
        for (const item of actual as Iterable<unknown>) {
          if (Object.is(item, expected)) {
            contains = true;
            break;
          }
        }
      }
      check(
        contains,
        `Expected ${fmt(actual)} to contain ${fmt(expected)}`,
        `Expected ${fmt(actual)} not to contain ${fmt(expected)}`,
      );
    },

    toMatch(pattern: string | RegExp): void {
      const str = String(actual);
      const matched = typeof pattern === 'string' ? str.includes(pattern) : pattern.test(str);
      check(
        matched,
        `Expected ${fmt(str)} to match ${fmt(pattern)}`,
        `Expected ${fmt(str)} not to match ${fmt(pattern)}`,
      );
    },

    toThrow(expected?: string | RegExp | Error | (new (...args: unknown[]) => Error)): void {
      if (typeof actual !== 'function') {
        throw new AssertionFailure(`Expected a function for toThrow, received ${typeof actual}`);
      }
      let threw = false;
      let thrown: unknown;
      try {
        (actual as () => unknown)();
      } catch (err) {
        threw = true;
        thrown = err;
      }

      if (!threw) {
        check(false, 'Expected function to throw, but it did not', '');
        return;
      }

      if (expected === undefined) {
        check(true, '', `Expected function not to throw, but it threw ${fmt(thrown)}`);
        return;
      }

      const msg = thrown instanceof Error ? thrown.message : String(thrown);
      let matches = false;
      if (typeof expected === 'string') {
        matches = msg.includes(expected);
      } else if (expected instanceof RegExp) {
        matches = expected.test(msg);
      } else if (expected instanceof Error) {
        matches = thrown instanceof Error && thrown.message === expected.message;
      } else if (typeof expected === 'function') {
        matches = thrown instanceof expected;
      }

      check(
        matches,
        `Expected thrown error ${fmt(thrown)} to match ${fmt(expected)}`,
        `Expected thrown error ${fmt(thrown)} not to match ${fmt(expected)}`,
      );
    },

    toBeTruthy(): void {
      check(
        Boolean(actual),
        `Expected ${fmt(actual)} to be truthy`,
        `Expected ${fmt(actual)} not to be truthy`,
      );
    },

    toBeFalsy(): void {
      check(
        !actual,
        `Expected ${fmt(actual)} to be falsy`,
        `Expected ${fmt(actual)} not to be falsy`,
      );
    },

    toBeNull(): void {
      check(
        actual === null,
        `Expected ${fmt(actual)} to be null`,
        `Expected ${fmt(actual)} not to be null`,
      );
    },

    toBeUndefined(): void {
      check(
        actual === undefined,
        `Expected ${fmt(actual)} to be undefined`,
        `Expected ${fmt(actual)} not to be undefined`,
      );
    },

    toBeDefined(): void {
      check(
        actual !== undefined,
        `Expected value to be defined`,
        `Expected ${fmt(actual)} not to be defined`,
      );
    },

    toHaveLength(expected: number): void {
      const len =
        typeof actual === 'string'
          ? actual.length
          : actual !== null && typeof actual === 'object' && 'length' in actual
            ? (actual as { length: unknown }).length
            : undefined;
      check(
        len === expected,
        `Expected length ${fmt(len)} to be ${expected}`,
        `Expected length ${fmt(len)} not to be ${expected}`,
      );
    },

    toBeGreaterThan(expected: number | bigint): void {
      const ok =
        (typeof actual === 'number' || typeof actual === 'bigint') && actual > expected;
      check(
        ok,
        `Expected ${fmt(actual)} to be greater than ${fmt(expected)}`,
        `Expected ${fmt(actual)} not to be greater than ${fmt(expected)}`,
      );
    },

    toBeLessThan(expected: number | bigint): void {
      const ok =
        (typeof actual === 'number' || typeof actual === 'bigint') && actual < expected;
      check(
        ok,
        `Expected ${fmt(actual)} to be less than ${fmt(expected)}`,
        `Expected ${fmt(actual)} not to be less than ${fmt(expected)}`,
      );
    },

    toBeInstanceOf(ctor: abstract new (...args: never[]) => unknown): void {
      check(
        actual instanceof ctor,
        `Expected ${fmt(actual)} to be an instance of ${ctor.name}`,
        `Expected ${fmt(actual)} not to be an instance of ${ctor.name}`,
      );
    },
  };

  return matchers;
}

export function expect<T>(actual: T): Matchers<T> {
  return createMatchers(actual, false);
}

export interface MockResult {
  type: 'return' | 'throw';
  value: unknown;
}

export interface MockState {
  calls: unknown[][];
  results: MockResult[];
}

export interface MockFunction<TArgs extends unknown[] = unknown[], TResult = unknown> {
  (...args: TArgs): TResult;
  readonly mock: MockState;
  mockClear(): void;
  mockReset(): void;
  mockRestore(): void;
  mockImplementation(impl: (...args: TArgs) => TResult): MockFunction<TArgs, TResult>;
  mockReturnValue(value: TResult): MockFunction<TArgs, TResult>;
}

export function mock<TArgs extends unknown[] = unknown[], TResult = unknown>(
  fn?: (...args: TArgs) => TResult,
): MockFunction<TArgs, TResult> {
  let impl: ((...args: TArgs) => TResult) | undefined = fn;
  const state: MockState = {
    calls: [],
    results: [],
  };

  const mockFn = function (this: unknown, ...args: TArgs): TResult {
    state.calls.push(args);
    try {
      const value = impl ? impl.apply(this, args) : (undefined as TResult);
      state.results.push({ type: 'return', value });
      return value;
    } catch (err) {
      state.results.push({ type: 'throw', value: err });
      throw err;
    }
  } as MockFunction<TArgs, TResult>;

  Object.defineProperty(mockFn, 'mock', {
    value: state,
    enumerable: true,
    configurable: false,
  });

  mockFn.mockClear = () => {
    state.calls.length = 0;
    state.results.length = 0;
  };

  mockFn.mockReset = () => {
    mockFn.mockClear();
    impl = undefined;
  };

  mockFn.mockRestore = () => {
    mockFn.mockReset();
  };

  mockFn.mockImplementation = (nextImpl: (...args: TArgs) => TResult) => {
    impl = nextImpl;
    return mockFn;
  };

  mockFn.mockReturnValue = (value: TResult) => {
    impl = () => value;
    return mockFn;
  };

  return mockFn;
}

export function spyOn<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  method: K,
): MockFunction {
  const original = obj[method];
  if (typeof original !== 'function') {
    throw new TypeError(`Cannot spyOn property "${String(method)}": not a function`);
  }

  const spy = mock(function (this: unknown, ...args: unknown[]) {
    return (original as (...a: unknown[]) => unknown).apply(this, args);
  });

  spy.mockRestore = () => {
    spy.mockClear();
    obj[method] = original;
  };

  obj[method] = spy as unknown as T[K];
  return spy;
}
