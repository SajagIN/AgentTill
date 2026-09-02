import fs from 'fs';

let content = fs.readFileSync('src/money-actions.js', 'utf-8');

// The M2 check is actually checking against catalog! Let's check where it lies.
console.log(content.includes("quote->order mismatch"));
