import { readFile, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { cardHtml, cardPublicData, questionOptions, questions, sectorsOfInterest } from "./schema.mjs";
import { choices } from "../docs/options.js";

const paths = ["../docs/options.js", "schema.mjs", "bot.mjs", "../api/worker.mjs", "widget.html"];
const [catalog,schema,bot,worker,template] = await Promise.all(paths.map(path=>readFile(new URL(path,import.meta.url),"utf8")));
const html=cardHtml(template);
const size=deflateSync(html,{level:9}).length;
if (size>4096 || Buffer.byteLength(html)>32768) throw Error("Виджет превышает лимит Telegram.");
if ([cardPublicData,...questions.map((_, i)=>JSON.stringify({items:questionOptions(i)}))].some(data=>Buffer.byteLength(data)>1024)) throw Error("Данные экрана превышают лимит Telegram.");
for (const [,values] of sectorsOfInterest) {
  const data=JSON.stringify({items:values.map(name=>[choices.interests.indexOf(name),name])});
  if(Buffer.byteLength(data)>1024) throw Error("Список не помещается в ответ Telegram.");
}
function inlineSource(source) {
  return source.replace(/^import .*;\n/gm,"").replace(/^export (?=const |async function |function )/gm,"");
}
const output=process.argv[2];
if(output) await writeFile(output,[inlineSource(catalog),inlineSource(schema),"const cardTemplate = "+JSON.stringify(template)+";",inlineSource(bot),inlineSource(worker)].join("\n"));
console.log("HTML "+Buffer.byteLength(html)+" bytes, zlib "+size+" bytes.");
