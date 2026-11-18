// Test fixture 1: Undefined property access
// Demonstrates runtime TypeError. With TypeScript checking enabled, flags possible undefined error.
const user = undefined;
console.log(user.name);
