// Fixture file for chunker boundary tests.
// Deliberately includes: a top-level function, a class with two methods,
// an interface, and a top-level arrow function — enough symbol variety to
// prove chunk boundaries land on real edges, not mid-body.

export interface Greeter {
  greet(name: string): string;
}

export function add(a: number, b: number): number {
  const sum = a + b;
  return sum;
}

export class UserService implements Greeter {
  private users: string[] = [];

  greet(name: string): string {
    return `Hello, ${name}!`;
  }

  addUser(name: string): void {
    this.users.push(name);
  }
}

export const multiply = (a: number, b: number): number => {
  return a * b;
};
