import "./report.css";
import type { ReactNode } from 'react';
/** A deliberately small formatter: model text is always escaped, never HTML or executable links. */
function inline(text:string):ReactNode[]{return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[E\d+\])/g).map((s,i)=>s.startsWith('**')&&s.endsWith('**')?<strong key={i}>{s.slice(2,-2)}</strong>:s.startsWith('`')&&s.endsWith('`')?<code key={i}>{s.slice(1,-1)}</code>:/^\[E\d+\]$/.test(s)?<span key={i} className="alfred-source-ref">{s}</span>:s);}
export function ReportText({text}:{text:string}){
 const lines=text.replace(/\r\n/g,'\n').split('\n'),out:ReactNode[]=[];let i=0;
 while(i<lines.length){const line=lines[i].trim();if(!line){i++;continue;}
  if(/^#{1,6}\s+/.test(line)){out.push(<h3 key={i}>{inline(line.replace(/^#{1,6}\s+/,''))}</h3>);i++;continue;}
  if(/^\*\*[^*]+\*\*:?$/.test(line)){out.push(<h3 key={i}>{inline(line)}</h3>);i++;continue;}
  if(/^```/.test(line)){const start=i++,code:string[]=[];while(i<lines.length&&!/^```/.test(lines[i]))code.push(lines[i++]);i++;out.push(<pre key={start}><code>{code.join('\n')}</code></pre>);continue;}
  if(/^([-*•]|\d+[.)])\s+/.test(line)){const start=i,ordered=/^\d/.test(line),items:ReactNode[]=[];while(i<lines.length&&/^([-*•]|\d+[.)])\s+/.test(lines[i].trim())){items.push(<li key={i}>{inline(lines[i].trim().replace(/^([-*•]|\d+[.)])\s+/,''))}</li>);i++;}out.push(ordered?<ol key={start}>{items}</ol>:<ul key={start}>{items}</ul>);continue;}
  if(/^(---+|\*\*\*+)$/.test(line)){out.push(<hr key={i++}/>);continue;}
  const start=i,paragraph:string[]=[];while(i<lines.length&&lines[i].trim()&&!/^(#{1,6}\s|[-*•]\s|\d+[.)]\s|```)/.test(lines[i].trim()))paragraph.push(lines[i++]);if(!paragraph.length){i++;continue;}
  const joined=paragraph.join(' ');const sentences=joined.length>600?joined.split(/(?<=[.!?])\s+(?=[A-Z])/):[joined];for(let n=0;n<sentences.length;n+=3)out.push(<p key={`${start}-${n}`}>{inline(sentences.slice(n,n+3).join(' '))}</p>);
 }
 return <div className="alfred-readable">{out}</div>;
}
