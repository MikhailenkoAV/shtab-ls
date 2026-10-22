import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { employeeReadiness } from '../app/readiness-rules.ts';
import { normalizePilotPersonalProfile } from '../app/pilot-profile-rules.ts';
import { restorePersonShifts, appendMissingRecords } from '../app/person-recovery-rules.ts';
import { externalFlightsForReport } from '../app/external-flight-rules.ts';
import { buildFlightBook } from '../app/flight-book-rules.ts';
import { buildFlightReport, buildEmploymentReport } from '../app/monthly-report.ts';
import { workspaceKey } from '../app/workspace-storage-rules.ts';
import { busyBlockReason } from '../app/monthly-plan-rules.ts';

const person = {id:'p',name:'Тестовый Пилот',active:true,position:'КВС',aircraftTypes:['R44']};
const external = {id:'e',personId:'p',month:'2026-10',aircraftType:'R44',aircraft:'RA-04186',seat:'КВС',purpose:'КВП',flightMinutes:60,nightMinutes:15,source:'Тест',note:'',createdAt:'2026-10-20'};
const profile = normalizePilotPersonalProfile({medical:{expiryDate:'2026-09-01'},readiness:{override:'allowed',until:'2026-10-01',reason:'Тест'}});

test('temporary manual readiness expires after the selected local calendar day', () => {
  assert.equal(employeeReadiness([],profile,new Date('2026-10-01T23:59:00')).status,'allowed');
  const next=employeeReadiness([],profile,new Date('2026-10-02T00:00:00'));
  assert.equal(next.status,'not_allowed');assert.equal(next.manual,false);
  assert.equal(profile.readiness.override,'allowed'); // history remains intact
});

test('restoring a person preserves newer notes, timings and commander assignments in surviving shifts', () => {
  const saved=[{id:'own',personId:'p',segments:[]},{id:'shared',personId:'q',note:'Old',segments:[{id:'s',commanderPersonId:'p',flightMinutes:40}]}];
  const current=[{id:'shared',personId:'q',note:'New',segments:[{id:'s',flightMinutes:90}]}];
  const restored=restorePersonShifts(current,saved,'p');
  assert.equal(restored.find(x=>x.id==='shared').note,'New');assert.equal(restored[0].segments[0].flightMinutes,90);assert.equal(restored[0].segments[0].commanderPersonId,'p');assert.equal(restored.length,2);
  current[0].segments[0].commanderPersonId='new-commander';
  assert.equal(restorePersonShifts(current,saved,'p')[0].segments[0].commanderPersonId,'new-commander');
  assert.equal(restorePersonShifts([],saved,'p').some(x=>x.id==='shared'),false);
  assert.deepEqual(appendMissingRecords([{id:'e',note:'New'}],[{id:'e',note:'Old'}]),[{id:'e',note:'New'}]);
});

test('monthly certificates are included only as whole known periods, without inventing flight dates', () => {
  const whole=externalFlightsForReport([external],'2026-10-01','2026-10-31');
  assert.equal(whole.length,1);assert.equal(whole[0].date,'2026-10-31');assert.equal(whole[0].externalFlight,true);
  assert.throws(()=>externalFlightsForReport([external],'2026-10-15','2026-10-31'),/Уточните даты/);
  assert.equal(externalFlightsForReport([{...external,dateFrom:'2026-10-18',dateTo:'2026-10-20'}],'2026-10-15','2026-10-31').length,1);
  assert.deepEqual(externalFlightsForReport([external],'2026-11-01','2026-11-30'),[]);
  assert.deepEqual(externalFlightsForReport([external],'2026-10-15','2026-10-31','other'),[]);
});

test('a certificate intersecting a flight-book baseline requires an explicit inclusion choice', () => {
  const baseline={id:'base',personId:'p',date:'2026-10-10',source:'Тест',note:'',rows:[],createdAt:''};
  assert.equal(buildFlightBook('p',[],[baseline],[],[external]).warnings.length,1);
  const additional=buildFlightBook('p',[],[baseline],[],[{...external,baselineDisposition:'additional'}]);
  assert.equal(additional.total.totalMinutes,60);assert.equal(additional.warnings.length,0);
  assert.equal(buildFlightBook('p',[],[baseline],[],[{...external,baselineDisposition:'included'}]).total.totalMinutes,0);
});

function tables(node) {
  if(!node||typeof node!=='object') return [];
  return [...(node.table?[node.table]:[]),...Object.values(node).flatMap(v=>Array.isArray(v)?v.flatMap(tables):tables(v))];
}

test('flight report combines board numbers, retains separate purpose and chair, and sums night time', () => {
  const segment=(aircraft,minutes,night,purpose='КВП',seat='КВС')=>({aircraft,aircraftType:'R44',seat,purpose,flightMinutes:minutes,nightMinutes:night});
  const report=buildFlightReport('2026-10-01','2026-10-31',[person],[{personId:'p',date:'2026-10-20',activity:'flight',segments:[segment('RA-04186',60,10),segment('RA-04359',90,20),segment('RA-04186',30,0,'АОН'),segment('RA-04359',15,0,'КВП','Пилот-инструктор')]}],'p');
  const table=tables(report).find(t=>t.body[0].some(c=>c.text==='Кресло'));
  assert.equal(table.body.length,5); // header + 3 groups + total
  const row=table.body.find(r=>r[0]?.text==='КВС'&&r[2]?.text==='КВП');
  assert.equal(row[3].text,'2:30');assert.equal(row[4].text,'0:30');
  assert.equal(table.widths.length,5);assert.ok(table.body.every(r=>r.length===5));
  assert.doesNotMatch(JSON.stringify(report),/RA-04186|RA-04359|Бортовой №/);
});

test('archived staff with only planned assignments or leave appear in the overall period report', () => {
  for(const [assignments,busy] of [[[{id:'a',personId:'p',date:'2026-10-04',aircraft:'RA-04186',role:'primary'}],[]],[[],[{id:'b',personId:'p',dateFrom:'2026-10-01',dateTo:'2026-10-05',activity:'vacation',note:''}]]]) {
    const report=buildEmploymentReport('2026-10-01','2026-10-31',[{...person,active:false}],[],null,undefined,assignments,busy);
    assert.match(JSON.stringify(report),/Тестовый Пилот/);
  }
});

test('account storage, sync base and recovery history never share keys across owners', () => {
  for(const name of ['primary','cloud-sync-state-v1','recovery-checkpoints-v1']) assert.notEqual(workspaceKey('a',name),workspaceKey('b',name));
  assert.throws(()=>workspaceKey('','primary'));
});

test('busy planning applies the same employment interval checks as flight planning', () => {
  const employee={...person,employmentHistory:[{id:'d',kind:'dismissed',date:'2026-10-01',recordedAt:'',orderNumber:''},{id:'r',kind:'rehired',date:'2026-10-20',recordedAt:'',orderNumber:''}]};
  assert.match(busyBlockReason('p','2026-10-15',[],[],[],undefined,employee),/не состоял/);
  assert.equal(busyBlockReason('p','2026-10-21',[],[],[],undefined,employee),null);
});

test('public build contains no embedded personnel seed records or historical workbooks', async () => {
  const files=await readdir(new URL('../out/_next/static/chunks/',import.meta.url));
  for(const file of files.filter(f=>f.endsWith('.js'))) {
    const source=await readFile(new URL('../out/_next/static/chunks/'+file,import.meta.url),'utf8');
    assert.doesNotMatch(source,/registry-order-5|medical-referral-13|barkov-source\.xlsx/);
  }
});
