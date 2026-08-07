/* eslint-disable @next/next/no-img-element */
"use client";
import { FormEvent, useState } from "react";
import { supabase } from "./cloud-client";

export function CloudLogin() {
  const [email,setEmail]=useState(""); const [password,setPassword]=useState(""); const [error,setError]=useState(""); const [loading,setLoading]=useState(false);
  async function submit(event:FormEvent){event.preventDefault();setLoading(true);setError("");const {error:failure}=await supabase.auth.signInWithPassword({email:email.trim(),password});if(failure)setError("Не удалось войти. Проверьте почту и пароль.");setLoading(false);}
  return <main className="cloud-gate"><section className="panel cloud-login"><div className="brand-mark"><img src="sidebar-icon.png" alt=""/></div><p className="eyebrow">ШТАБ ЛС · облачный контур</p><h1>Вход в рабочую базу</h1><p>После входа откроется единая актуальная база на всех ваших устройствах.</p><form className="form-stack" onSubmit={submit}><label className="field"><span>Электронная почта</span><input type="email" required autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}/></label><label className="field"><span>Пароль</span><input type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<div className="form-error">{error}</div>}<button className="primary-button" disabled={loading}>{loading?"Вхожу…":"Войти"}</button></form><small>Пароль передаётся напрямую в Supabase Auth и не сохраняется в коде сайта.</small></section></main>;
}

export function CloudMigration({counts,onUpload,onSignOut,loading,error}:{counts:{people:number;shifts:number;documents:number};onUpload:()=>void;onSignOut:()=>void;loading:boolean;error:string}){
 return <main className="cloud-gate"><section className="panel cloud-migration"><p className="eyebrow">Первичное подключение</p><h1>Перенос локальной базы в облако</h1><p>Облачная база пока пуста. Проверьте состав локальных данных и подтвердите перенос. Ничего не будет загружено без нажатия кнопки.</p><div className="import-current-state"><span>Сотрудников <strong>{counts.people}</strong></span><span>Смен <strong>{counts.shifts}</strong></span><span>Документов <strong>{counts.documents}</strong></span></div>{error&&<div className="form-error">{error}</div>}<div className="form-actions"><button className="secondary-button" onClick={onSignOut}>Выйти</button><button className="primary-button" onClick={onUpload} disabled={loading}>{loading?"Переношу и проверяю…":"Перенести в облако"}</button></div><small>Локальная копия сохранится на этом устройстве как офлайн-резерв.</small></section></main>;
}
