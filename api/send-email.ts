import { emailHtml, type EmailTemplateKind } from '../src/email/templates';
const allowed:EmailTemplateKind[]=['verify','reset','alert'];
type Request={method?:string;body?:{to?:unknown;kind?:unknown}};type Response={status(code:number):Response;json(data:unknown):void};
export default async function handler(req:Request,res:Response){
 if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
 const {to,kind='verify'}=req.body??{};
 if(typeof to!=='string'||!/^\S+@\S+\.\S+$/.test(to)||!allowed.includes(kind)) return res.status(400).json({error:'Invalid recipient or template'});
 const key=process.env.RESEND_API_KEY;
 const from=process.env.RESEND_FROM_EMAIL;
 if(!key||!from) return res.status(503).json({error:'邮件服务尚未配置，请在 Vercel 设置 RESEND_API_KEY 和 RESEND_FROM_EMAIL'});
 const names={verify:'注册邮箱验证',reset:'密码重置通知',alert:'DomainHub 系统通知'};
 const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({from,to,subject:names[kind as EmailTemplateKind],html:emailHtml(kind as EmailTemplateKind)})});
 const data=await response.json();
 if(!response.ok) return res.status(response.status).json({error:data?.message??'邮件发送失败'});
 return res.status(200).json({success:true,id:data.id});
}
