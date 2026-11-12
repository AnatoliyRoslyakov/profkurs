import { choices } from "../docs/options.js";
import { cardHtml, decodeAnswers, sectorsOfInterest } from "./schema.mjs";
import cardTemplate from "./widget.html";

const ownerBot = "prof0bot";
const credentialKey = "telegram/prof0bot/credentials";
const encoder = new TextEncoder();
const cardMarkup = cardHtml(cardTemplate);

function publicText(text, status = 200) {
  return new Response(text, {status, headers: {"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}});
}

async function telegramCall(token, method, body = {}) {
  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method:"POST", redirect:"manual", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)
  });
  const value = await response.json();
  if (!response.ok || !value.ok) throw new Error("Telegram " + method + " " + response.status);
  return value.result;
}

async function digest(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
  return Array.from(bytes, n => n.toString(16).padStart(2,"0")).join("");
}

function setupScreen(proof, message = "", status = 200) {
  const page = '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Подключение @prof0bot</title><style>html{color-scheme:light dark}body{max-width:32rem;margin:10vh auto;padding:1rem;font:17px/1.5 system-ui}input,button{font:inherit;padding:.65rem;border-radius:.5rem}input{display:block;box-sizing:border-box;width:100%;margin:.5rem 0 1rem}a{color:LinkText}button{cursor:pointer}h1{line-height:1.15}</style><h1>Подключить «Профкурс»</h1>'
    + (message ? '<p role="status">'+message+'</p>' : '')
    + '<p>Только для владельца <b>@prof0bot</b>. В <a href="https://t.me/BotFather">@BotFather</a> откройте /mybots → @prof0bot → API Token. Скопируйте действующий токен и вставьте ниже.</p><form method="post"><input type="hidden" name="proof" value="'+proof+'"><label>Токен @prof0bot<input type="password" name="token" required maxlength="120" autocomplete="off" spellcheck="false"></label><button>Подключить карточку</button></form><p>Сервер «Профкурса» проверит токен через Telegram и сохранит его в зашифрованном виде для ответов бота. После подключения команда /start откроет анкету прямо в чате.</p></html>';
  return new Response(page, {status, headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Robots-Tag":"noindex, nofollow","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}});
}

async function boxKey(secret) {
  const raw = await crypto.subtle.digest("SHA-256",encoder.encode("profkurs/credentials/"+secret));
  return crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt","decrypt"]);
}
async function storeToken(env, token) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:"AES-GCM",iv},await boxKey(env.TELEGRAM_CARD_SECRET),encoder.encode(token));
  await env.CARD_DATA.put(credentialKey, JSON.stringify({iv:Array.from(iv), data:Array.from(new Uint8Array(encrypted))}));
}
async function readToken(env) {
  const object = await env.CARD_DATA.get(credentialKey);
  if (!object) throw new Error("Bot not connected");
  const saved = await object.json();
  const raw = await crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(saved.iv)},await boxKey(env.TELEGRAM_CARD_SECRET),new Uint8Array(saved.data));
  return new TextDecoder().decode(raw);
}

async function connectBot(request, env, origin, hookSecret) {
  const proof = await digest("profkurs/setup-form/"+env.TELEGRAM_CARD_SECRET);
  const screen = (message, status) => setupScreen(proof,message,status);
  if (request.method === "GET") return screen();
  if (request.method !== "POST") return publicText("Используйте форму подключения.",405);
  const source = request.headers.get("Origin");
  if ((source && source !== "null" && source !== origin) || request.headers.get("Sec-Fetch-Site") === "cross-site")
    return publicText("Откройте персональную ссылку подключения и отправьте форму с этой страницы.",403);
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/x-www-form-urlencoded") return publicText("Используйте форму подключения.",415);
  if (Number(request.headers.get("Content-Length")) > 512) return publicText("Слишком длинное значение.",413);
  const raw = await request.text();
  if (raw.length > 512) return publicText("Слишком длинное значение.",413);
  const fields = new URLSearchParams(raw);
  if (fields.get("proof") !== proof) return publicText("Форма устарела. Откройте персональную ссылку заново и повторите подключение.",403);
  const token = (fields.get("token") || "").trim();
  if (!/^\d{5,15}:[a-zA-Z0-9_-]{20,96}$/.test(token)) return screen("Проверьте формат токена.",400);
  let bot;
  try { bot = await telegramCall(token,"getMe"); } catch { return screen("Telegram не подтвердил токен. Проверьте его в BotFather.",400); }
  if (bot.username?.toLowerCase() !== ownerBot) return screen("Этот токен принадлежит другому боту.",400);
  const url = origin + "/telegram/webhook";
  const current = await telegramCall(token,"getWebhookInfo");
  if (current.url && current.url !== url) return screen("У бота уже есть другой webhook. Отключите его у прежнего обработчика, если хотите заменить его «Профкурсом».",409);
  await storeToken(env,token);
  await telegramCall(token,"setWebhook",{url,secret_token:hookSecret,allowed_updates:["message","widget_query"],drop_pending_updates:false});
  return publicText("Готово. Откройте https://t.me/prof0bot и отправьте /start. В чате появится карточка «Профкурс».");
}

const summary = record => record.status === "ready"
  ? {job:record.job, titles:record.result.directions.map(direction=>direction.profession)}
  : record.status === "error" ? {job:record.job,error:"Не удалось получить подборку. Попробуйте ещё раз."} : {job:record.job};

async function handleQuery(query, token, env, generate, allowed) {
  const answer = payload => telegramCall(token,"answerWidgetQuery",{widget_query_id:query.id,data:JSON.stringify(payload)});
  const chatId=query.chat?.id, messageId=query.message_id;
  if (query.chat?.type!=="private" || query.from?.id!==chatId || !Number.isSafeInteger(messageId) || query.type?.type!=="data")
    return answer({error:"Откройте анкету в личном чате с @prof0bot."});
  const args=String(query.data||"").split(":");
  if (args[0]==="i" && args.length===2 && /^\d{1,2}$/.test(args[1])) {
    const entry=sectorsOfInterest[Number(args[1])];
    if (entry) return answer({items:entry[1].map(name=>[choices.interests.indexOf(name),name])});
  }
  const [op,job,one,two]=args;
  if (!/^[a-z0-9]{4,12}$/.test(job||"")) return answer({error:"Откройте новую анкету через /start."});
  const key="telegram/card/"+await digest(chatId+"/"+messageId);
  const bucket=env.CARD_DATA;
  const object=await bucket.get(key);
  const record=object ? await object.json() : null;
  const edit = stage => telegramCall(token,"editMessageWidgetData",{chat_id:chatId,message_id:messageId,chat_data:JSON.stringify(summary(stage))});
  if (op==="x" && args.length===2 && record?.job===job) {
    const erased=await bucket.put(key,JSON.stringify({job,status:"cleared"}),{onlyIf:{etagMatches:object.etag}});
    if (!erased) return answer({error:"Карточка изменилась. Откройте её снова."});
    await telegramCall(token,"editMessageWidgetData",{chat_id:chatId,message_id:messageId,chat_data:""}).catch(()=>{});
    return answer({ok:true});
  }
  if (op==="r" && args.length===4 && record?.job===job && record.status==="ready" && /^[0-3]$/.test(one) && /^[0-3]$/.test(two)) {
    const route=record.result.directions[Number(one)];
    const text=one==="3" ? record.result.connection : [route.why,route.environment,route.branches.join(" · "),route.firstStep][Number(two)];
    let fitting=text;
    while(encoder.encode(JSON.stringify({text:fitting})).length>1024) fitting=Array.from(fitting).slice(0,-8).join("").trimEnd()+"…";
    return answer({text:fitting});
  }
  if (op==="p" || (op==="s" && record?.job===job && record.status==="ready")) {
    if (record?.job!==job) return answer({error:"Вернитесь к ответам и повторите подбор."});
    if (record.status==="busy" && Date.now()-record.at<65000) return answer({wait:true});
    await answer({ok:true});
    return edit(record.status==="busy"?{...record,status:"error"}:record).catch(()=>{});
  }
  if (op!=="s" || args.length!==4) return answer({error:"Откройте подборку снова."});
  const profile=decodeAnswers(one,two);
  if (!profile) return answer({error:"Проверьте ответы и повторите."});
  if (record?.status==="busy" && Date.now()-record.at<65000) return answer(record.job===job?{ok:true}:{error:"Предыдущий подбор ещё идёт."});
  if (!await allowed(chatId)) return answer({error:"Попробуйте через минуту."});
  const pending={job,status:"busy",at:Date.now()};
  const claim=await bucket.put(key,JSON.stringify(pending),{onlyIf:object?{etagMatches:object.etag}:{etagDoesNotMatch:"*"}});
  if (!claim) return answer({error:"Подбор уже обрабатывается. Проверьте результат."});
  await answer({ok:true}).catch(()=>{});
  let finished;
  try { finished={job,status:"ready",result:await generate(profile)}; }
  catch { finished={job,status:"error"}; }
  const saved=await bucket.put(key,JSON.stringify(finished),{onlyIf:{etagMatches:claim.etag}});
  if (saved) await edit(finished);
}

export async function handleTelegram(request, env, ctx, generate, allowed) {
  const url=new URL(request.url);
  if (!env.CARD_DATA || !env.TELEGRAM_CARD_SECRET) return publicText("Подключение пока недоступно.",503);
  const hookSecret=await digest("profkurs/hook/"+env.TELEGRAM_CARD_SECRET);
  const admin="/telegram/connect/"+(await digest("profkurs/setup/"+env.TELEGRAM_CARD_SECRET)).slice(0,32);
  if (url.pathname===admin) return connectBot(request,env,url.origin,hookSecret);
  if (url.pathname===admin+"/status" && request.method==="GET") {
    if (!await env.CARD_DATA.head(credentialKey)) return publicText("awaiting_owner");
    const info=await telegramCall(await readToken(env),"getWebhookInfo");
    return publicText(info.url===url.origin+"/telegram/webhook" ? "connected" : "awaiting_webhook");
  }
  if (url.pathname!=="/telegram/webhook" || request.method!=="POST") return publicText("Адрес не найден.",404);
  if (request.headers.get("X-Telegram-Bot-Api-Secret-Token")!==hookSecret) return publicText("Доступ закрыт.",403);
  const update=await request.json();
  const token=await readToken(env);
  if (update.widget_query) {
    const processing=handleQuery(update.widget_query,token,env,generate,allowed);
    ctx?.waitUntil(processing.catch(()=>{}));
    await processing;
  } else if (update.message?.chat?.type==="private" && /^\/(?:start|profkurs)(?:@prof0bot)?(?:\s|$)/i.test(update.message.text||"")) {
    const chat=update.message.chat.id;
    const startKey="telegram/start/"+await digest(String(chat));
    const last=await env.CARD_DATA.get(startKey);
    if (!last || Number(await last.text())!==update.update_id) {
      await telegramCall(token,"sendWidget",{chat_id:chat,html:cardMarkup,allow_queries:true,width:320,height:540,caption:"Профкурс · карьерный подбор"});
      await env.CARD_DATA.put(startKey,String(update.update_id));
    }
  }
  return publicText("ok");
}
