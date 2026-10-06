const fs = require('node:fs');
(async () => {
  const pages = await fetch('http://127.0.0.1:9222/json/list').then(r=>r.json());
  const ws = new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let id=0; const pending=new Map(); let role='ADMIN'; const errors=[];
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}));});
  const courses=[{id:'c1',code:'CSC301',title:'Database Systems',creditHours:3,courseworkWeight:40,lecturer:{user:{firstName:'Alhaji',lastName:'Kamara'}}},{id:'c2',code:'CSC303',title:'Software Engineering',creditHours:3,courseworkWeight:40}];
  const users=[{id:'u1',firstName:'Alhaji',lastName:'Kamara',email:'alhaji@example.com',role:'ADMIN',isActive:true},{id:'u2',firstName:'Mariama',lastName:'Kamara',email:'mariama@example.com',role:'STUDENT',isActive:true}];
  const app={id:'a1',reference:'APP-2026-0142',state:'UNDER_REVIEW',feeStatus:'CONFIRMED',submittedAt:'2026-10-01T09:14:00Z',programme:{code:'CS',name:'BSc Computer Science'},intake:{name:'2026/2027'},applicant:{firstName:'Mariama',lastName:'Kamara',email:'mariama@example.com'},nextAction:'Your application is under academic review.',documents:[{id:'d1',requirementCode:'ID',fileName:'National ID.pdf',state:'AVAILABLE'}],decisions:[],draft:{},paymentReference:'PAY-0142'};
  const enrollments=[{id:'e1',academicYear:'2026/2027',semester:1,status:'ACTIVE',courseworkScore:80,examScore:80,score:80,grade:'A',gradePoint:4,course:courses[0],student:{id:'s1',studentNumber:'STU-2026-0142',user:{firstName:'Mariama',lastName:'Kamara'}}}];
  function fixture(path){
    if(path==='/api/auth/me')return {id:'u1',firstName:role==='STUDENT'?'Brima':'Alhaji',lastName:'Kamara',email:'demo@example.com',role,student:role==='STUDENT'?{id:'s1',studentNumber:'STU-2026-0142'}:null,staff:role==='LECTURER'?{id:'f1'}:null};
    if(path==='/api/terms/current')return {id:'t1',academicYear:'2026/2027',semester:1,maxCredits:24};
    if(path==='/api/reports/summary')return {students:{byStatus:{ACTIVE:1248},activeByProgramme:[['General Arts',320],['Business Studies',248],['Computer Studies',196],['Education',182],['Health Sciences',142],['Engineering',96],['Agriculture',64]].map(([name,count])=>({programme:{name},count}))},staff:68,courses:42};
    if(path==='/api/announcements')return [{id:'n1',title:'Department Meeting',body:'All computing lecturers are invited to the department meeting.',publishedAt:'2026-10-03T10:00:00Z'}];
    if(path==='/api/audit-logs')return {items:['Updated academic calendar','Approved applications','Created course','Published results','Added user'].map((action,i)=>({id:String(i),createdAt:'2026-10-03T14:32:00Z',action,entity:'College record',actor:users[0]}))};
    if(path==='/api/courses')return courses;
    if(path==='/api/users')return {items:users};
    if(path==='/api/enrollments')return enrollments;
    if(path==='/api/admissions/applications')return {items:[app]};
    if(path==='/api/admissions/applications/a1')return app;
    if(path==='/api/terms')return [{id:'t1',academicYear:'2026/2027',semester:1,isCurrent:true,resultsPublishedAt:'2027-03-12',maxCredits:24}];
    if(path==='/api/students/s1')return {studentNumber:'STU-2026-0142',status:'ACTIVE',yearOfStudy:3,phone:'+232 76 123 456',address:'Hill Station, Freetown',dateOfBirth:'2004-05-14',user:{firstName:'Brima',lastName:'Conteh',email:'brima@example.com'},programme:{name:'BSc Computer Science',code:'CS',department:{name:'Computer Science'}}};
    if(path.endsWith('/transcript'))return {cgpa:3.8,standing:'GOOD',terms:[{term:'2026/2027 Semester 1',gpa:3.8,credits:15,resultsPublished:true,courses:courses.map(c=>({code:c.code,title:c.title,creditHours:3,grade:'A',gradePoint:4}))}]};
    if(path.endsWith('/timetable'))return [{id:'slot1',dayOfWeek:7,startTime:'10:00',endTime:'11:30',room:'Lab 2',course:courses[0]}];
    if(path.endsWith('/attendance'))return [];
    return [];
  }
  ws.addEventListener('message',async event=>{const msg=JSON.parse(event.data);if(msg.id){const task=pending.get(msg.id);pending.delete(msg.id);if(msg.error)task.reject(msg.error);else task.resolve(msg.result);}else if(msg.method==='Fetch.requestPaused'){const path=new URL(msg.params.request.url).pathname;await send('Fetch.fulfillRequest',{requestId:msg.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(fixture(path))).toString('base64')});}else if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.text);});
  await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*/api/*'}]});
  const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true})).result.value;
  await send('Page.navigate',{url:'http://127.0.0.1:4173/login'});await new Promise(r=>setTimeout(r,400));
  await evaluate("sessionStorage.setItem('cms.token','visual-fixture')");
  const cases=[['ADMIN','/','overview'],['ADMIN','/users','users'],['STUDENT','/registration','registration'],['LECTURER','/gradebook?courseId=c1','gradebook'],['STUDENT','/results','results'],['REGISTRAR','/students/record?id=s1','student-record'],['ADMISSIONS_OFFICER','/applications','applications'],['APPLICANT','/applications/a1','application'],['STUDENT','/','student-dashboard'],['LECTURER','/','lecturer-dashboard']];
  for(const [caseRole,path,name] of cases){role=caseRole;await send('Emulation.setDeviceMetricsOverride',{width:1536,height:1024,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:'http://127.0.0.1:4173'+path});await new Promise(r=>setTimeout(r,600));const metrics=await evaluate('JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth,heading:document.querySelector("h2")?.innerText})');console.log(name+' '+metrics);const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('docs/frontend-previews/'+name+'-desktop.png',Buffer.from(shot.data,'base64'));}
  for(const [caseRole,path,name] of [['STUDENT','/registration','registration'],['ADMIN','/','overview'],['STUDENT','/','student-dashboard']]){role=caseRole;await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await send('Page.navigate',{url:'http://127.0.0.1:4173'+path});await new Promise(r=>setTimeout(r,500));console.log(name+'-mobile '+await evaluate('JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth})'));const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('docs/frontend-previews/'+name+'-mobile.png',Buffer.from(shot.data,'base64'));}
  await evaluate("sessionStorage.removeItem('cms.token')");await send('Page.navigate',{url:'http://127.0.0.1:4173/login'});await new Promise(r=>setTimeout(r,400));console.log('login-mobile '+await evaluate('JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth})'));const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('docs/frontend-previews/login-mobile.png',Buffer.from(shot.data,'base64'));
  console.log('Browser exceptions: '+JSON.stringify(errors));await send('Fetch.disable');ws.close();
})().catch(e=>{console.error(e);process.exit(1)});
