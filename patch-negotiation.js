import fs from 'fs';
const data = fs.readFileSync('src/negotiation.js', 'utf8');
fs.writeFileSync('src/negotiation.js', data.replace("import { findProduct } from \"./catalog.js\";", "import { findProduct } from \"./db.js\";"));
