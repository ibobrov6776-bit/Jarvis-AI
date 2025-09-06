import fs from 'fs';

const path = 'server.js';
let s = fs.readFileSync(path, 'utf8');

// 1) импорт cookie-parser
if (!s.includes('cookie-parser')) {
  s = s.replace(/from\s+["']express["'];?/, m => m + '\nimport cookieParser from "cookie-parser";');
}

// 2) импорт pin-guard (если файла ещё нет, мы его добавляли ранее как public/pin-guard.js)
if (!s.includes('pin-guard.js')) {
  s = s.replace(/from\s+["']express["'];?/, m => m + '\nimport pinGuard from "./public/pin-guard.js";');
}

// 3) подключение мидлваров сразу после const app = express();
if (!s.includes('app.use(cookieParser())')) {
  s = s.replace(/const\s+app\s*=\s*express\(\s*\)\s*;?/, m => m + '\napp.use(cookieParser());\napp.use(pinGuard(process.env.ACCESS_PIN || ""));');
}

fs.writeFileSync(path, s);
console.log('✅ server.js updated with cookie-parser + pin-guard');
