import fs from 'fs';
let content = fs.readFileSync('src/policy-rules.js', 'utf-8');
content = content.replace('const mandate = getMandate(actorId);', 'const mandate = getMandate(actorId); console.log("MANDATE:", mandate, "ACTOR:", actorId, "AMOUNT:", amountPaise);');
fs.writeFileSync('src/policy-rules.js', content);
