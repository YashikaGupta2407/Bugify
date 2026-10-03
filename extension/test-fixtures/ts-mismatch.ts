// Test fixture 4: TypeScript static type mismatch
// TypeScript language server reports: Type 'string' is not assignable to type 'number' (code 2322)
let userId: number = "user_42";
console.log(userId);
