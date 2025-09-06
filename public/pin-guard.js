export default function pinGuard(pin){
  return (req,res,next)=>{
    if(!pin) return next(); // PIN не задан — пропускаем

    // если уже есть корректная cookie
    if (req.cookies && req.cookies.pin === pin) return next();

    // обработка выхода
    if (req.method==='GET' && req.path==='/logout'){
      res.clearCookie('pin');
      res.setHeader('Content-Type','text/html; charset=utf-8');
      return res.end("<h2>Вы вышли</h2><a href='/'>На главную</a>");
    }

    // при попытке логина
    if (req.method==='POST' && req.path==='/pin'){
      let body="";
      req.on('data',c=>body+=c);
      req.on('end',()=>{
        const p=new URLSearchParams(body);
        if ((p.get('pin')||'')===pin){
          res.cookie('pin',pin,{httpOnly:true});
          return res.redirect('/');
        }
        res.statusCode=401;
        res.setHeader('Content-Type','text/html; charset=utf-8');
        res.end("<h2>Неверный PIN</h2><a href='/'>Попробовать снова</a>");
      });
      return;
    }

    // показываем форму
    if (!req.path.startsWith('/pin')){
      res.setHeader('Content-Type','text/html; charset=utf-8');
      return res.end(`<!doctype html><html><body style="font-family:-apple-system,system-ui,Segoe UI,Roboto,Arial,sans-serif;text-align:center;padding:40px;">
        <h2>Введите PIN для доступа</h2>
        <form method="POST" action="/pin">
          <input type="password" name="pin" style="padding:8px;font-size:16px"/>
          <button type="submit" style="padding:8px 16px;font-size:16px">Войти</button>
        </form>
      </body></html>`);
    }

    next();
  };
}
