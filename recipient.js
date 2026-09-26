(function(){
  'use strict';
  const root=document.getElementById('recipientList'),status=document.getElementById('receiptStatus'),title=document.getElementById('recipientTitle');
  let generation=0,view=null,priorView=null,seriesView=null;
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const link=(text,href,cls)=>{const n=el('a',text,cls);n.href=href;return n;};
  const button=(text,fn,cls)=>{const n=el('button',text,cls);n.type='button';n.onclick=fn;return n;};
  const reason=e=>{try{return MD.reason(e);}catch(_){return '전송 시점 비교 근거를 읽을 수 없습니다.';}};
  function render(){
    const token=++generation;if(view)view.close();view=null;if(priorView){priorView.close();priorView=null;}if(seriesView){seriesView.close();seriesView=null;}root.replaceChildren();status.textContent='';
    const query=new URLSearchParams(location.hash.slice(1)),mode=query.get('mode')==='sent'?'sent':'inbox';
    const id=query.get('record'),scope=query.get('scope');
    title.textContent=mode==='sent'?'보낸 사례 · LOCAL DEMO':'수신함 · LOCAL DEMO';
    if(id!==null){
      try{
        const store=MD.store(localStorage,scope||''),state=store.read(),r=state.sends[id];
        if(!r||r.id!==id||!MD.isLocalRecord(r))throw Error('Missing record');
        detail(r,scope,mode,state,store,token);
      }catch(_){root.append(el('p','해당 로컬 기록을 찾거나 읽을 수 없습니다.','md-inbox-empty'),link('목록으로',`recipient.html#mode=${mode}`,'md-record-back'));}
      return;
    }
    const entries=[];let failed=false;
    try{
      for(let i=0;i<localStorage.length;i++){
        const key=localStorage.key(i);if(!key?.startsWith('lesionlens:md:v1:'))continue;
        const recordScope=key.slice('lesionlens:md:v1:'.length);
        try{const state=MD.store(localStorage,recordScope).read();
          for(const [recordId,r] of Object.entries(state.sends))if(r?.id===recordId&&MD.isLocalRecord(r))entries.push({scope:recordScope,r,receipt:state.receipts[r.id]});
        }catch(_){failed=true;}
      }
    }catch(_){failed=true;}
    const list=el('div','','md-inbox-list');root.append(list);
    entries.sort((a,b)=>String(b.r.time).localeCompare(String(a.r.time))||a.scope.localeCompare(b.scope)||a.r.id.localeCompare(b.r.id));
    for(const {scope:recordScope,r,receipt} of entries){
      const card=el('article','','md-inbox-item md-received-card');card.dataset.recordId=r.id;card.dataset.scope=recordScope;
      card.append(el('h2',r.case.id),el('strong',reason(r.evidence),'md-inbox-reason'),
        el('p',`${r.sender} · ${r.time}`,'md-inbox-meta'),el('span',receipt?'수신 확인됨':'수신 미확인','md-inbox-state'),el('p',r.mode==='LOCAL_DEMO'?'연구 CT · 실제 환자 연결 없음':'시연 기록 · CT 없음','md-inbox-kind'),
        link('상세 보기',MD.recordLink(recordScope,r.id,mode),'md-record-link'));
      list.append(card);
    }
    if(!entries.length)list.append(el('p',mode==='sent'?'보낸 로컬 사례가 없습니다.':'저장된 LOCAL DEMO 수신 기록 없음','md-inbox-empty'));
    if(failed)status.textContent='일부 로컬 기록을 읽을 수 없습니다. 읽을 수 있는 기록만 표시합니다.';
  }
  function detail(r,scope,mode,state,store,token){
    const card=el('article','','md-record-detail md-received-card');card.dataset.recordId=r.id;card.dataset.scope=scope;
    const heading=el('h2',`${r.case.id} · ${mode==='sent'?'보낸 사례 상세':'수신 상세'}`);
    const summary=el('section','','md-detail-summary');
    const reference=el('details','','md-record-reference');reference.append(el('summary','참고 정보 · AI 요약과 전달 기록'));
    summary.append(heading,el('p',`${r.sender} · ${r.time}`,'md-detail-meta'));
    reference.append(el('p',r.mode==='LOCAL_DEMO'?'연구 데이터셋 CT의 LOCAL DEMO 전달 기록 · 합성 CT 아님 · 실제 환자/담당자 연결 없음':'합성 워크플로 시연 · 실제 CT/마스크 없음'),
      el('p',`보낸 역할: ${r.sender} · ${r.time}`),el('p',`수신 역할: ${r.recipient?.role||r.recipient?.recipientId||'DEMO 역할 정보 없음'}`),
      el('p',r.summary||'생성형 AI 소견 없음'),el('p',reason(r.evidence)),
      el('p',r.none?'모델 참고 없음':'참고 모델: '+(Array.isArray(r.selected)?r.selected.map(k=>MD.labels[k]||'알 수 없는 모델').join(', '):'선택 기록 오류')));
    if(r.binding)reference.append(el('p',`전송 시점 데이터: ${r.binding.manifestVersion} · ${r.binding.sourceCaseId} · ${r.case.sliceCount} 절편`));
    reference.append(el('p',r.viewpoint?'보낸 화면 위치 첨부 · 현재 원본 연결 확인 후 복원 · PNG/WebP 대비는 표시 전용 (HU 아님)':'기본 보기 · 첨부된 화면 위치 없음','md-record-viewpoint'));
    const memo=el('section','','md-record-memo');memo.append(el('h3','MD 사전 의견·후속조치·추가 소견'),
      el('p','사전 의견(참고) · '+MD.precheckLabel(r.precheck),'md-record-precheck'),
      el('p','의견 유형 · '+MD.followupLabel(r.followup),'md-record-followup'),
      el('p',typeof r.notes==='string'?(r.notes.trim()||'추가 메모가 없습니다.'):'메모 기록을 읽을 수 없습니다.'));
    const biopsyLine=el('p','조직검사 후보 · '+MD.biopsyCandidateLabel(r.biopsyCandidate),'md-record-biopsy');
    const protocolLine=el('p','조직검사 프로토콜 · '+MD.biopsyProtocolLabel(r.biopsyProtocol),'md-record-biopsy-protocol');
    const visitLine=el('p','내원 정보(시연 가정) · '+MD.visitLabel(r.visit?.status)+(r.visit?.requested===true?' · 주치의 외래 요청 요청됨(발송 아님)':''),'md-record-visit');
    memo.append(biopsyLine,protocolLine,visitLine);
    const why=el('section','','md-record-why');why.append(el('h3','재검토 이유'),el('strong',reason(r.evidence)),el('p','모델 비교 결과입니다. 진단이나 응급도를 뜻하지 않습니다.'));
    const essentials=el('div','','md-received-essentials');essentials.append(memo,why);
    card.append(link('목록으로',`recipient.html#mode=${mode}`,'md-record-back'),summary,essentials);
    const candidates=el('details','','md-record-candidates');candidates.append(el('summary','전송 시점 후보 근거'));
    for(const item of Array.isArray(r.evidence?.reasons)?r.evidence.reasons:[])candidates.append(el('p',`${item.candidateId} · ${MD.labels[item.model]||item.model} ↔ ${MD.labels[item.otherModel]||item.otherModel} · voxel ${Array.isArray(item.voxel)?item.voxel.join(', '):'미상'} · 절편 ${Number.isInteger(item.slice)?item.slice+1:'미상'}`));
    if(r.evidenceContext)candidates.append(el('p','전송 시점 모델 비교 규칙을 함께 보관한 기록 · 잠정 공학 기준 · 임상 검증 전'));
    if(!r.evidence)candidates.append(el('p','모델 비교 근거 미산출 · 전송 당시 근거 없음'));
    reference.append(candidates);
    const imageStatus=el('p','전송 시점 기록입니다. CT는 현재 데이터 연결을 확인한 뒤 표시합니다.','md-snapshot-status');imageStatus.setAttribute('role','status');
    const host=el('div','','md-received-viewer');host.hidden=true;
    const ctHeading=el('div','','md-received-ct-heading');ctHeading.append(el('h3','전달받은 CT'),el('p',r.none?'모델 참고 없음':'참고 모델: '+(Array.isArray(r.selected)?r.selected.map(k=>MD.labels[k]||'알 수 없는 모델').join(', '):'선택 기록 오류')));card.append(ctHeading,imageStatus);
    if(r.mode==='LOCAL_DEMO'){
      let biopsyActive=false;
      const biopsyButton=button('조직검사 후보 표시',()=>toggleBiopsy(),'md-record-biopsy-button');
      biopsyButton.setAttribute('aria-pressed','false');
      biopsyButton.disabled=!r.biopsyCandidate;
      biopsyButton.title=r.biopsyCandidate?'조직검사 후보 위치를 전달 CT에 표시합니다 · 표시 전용이며 판정·측정 아님':'이 기록에는 조직검사 후보가 기록되지 않았습니다.';
      const ct=button('전달 CT 보기',()=>toggleCt(),'md-record-ct-button');
      ct.setAttribute('aria-expanded','false');
      async function openViewer(){
        if(view)return view;
        ct.disabled=true;biopsyButton.disabled=true;imageStatus.textContent='보낼 때의 CT와 현재 CT가 같은지 확인 중…';card.dataset.bindingState='checking';
        try{
          const response=await fetch('/data/model_compare/manifest.json',{cache:'no-store'});
          if(!response.ok)throw Error('Manifest unavailable');
          const canonical=await MD.snapshotCase(r,await response.text(),normalizeManifest,scope);
          if(token!==generation)return;
          host.hidden=false;view=MDViewer.mount(host,canonical,r.none?['ct']:r.selected,r.viewpoint||null);
          if(r.none)host.querySelector('canvas')?.setAttribute('aria-label',`${canonical.id} CT · 모델 참고 없음 · 방향키 절편 이동`);
          card.dataset.bindingState='verified';imageStatus.textContent='보낼 때의 CT와 일치합니다 · 선택한 모델만 표시합니다';ct.textContent='전달 CT 접기';ct.setAttribute('aria-expanded','true');
          return view;
        }catch(_){
          if(token!==generation)return null;
          card.dataset.bindingState='mismatch';imageStatus.textContent='영상을 열 수 없습니다. 보낼 때의 CT와 현재 자료가 다르거나 확인할 수 없습니다. 전달 메모는 계속 볼 수 있습니다.';
          host.hidden=true;host.replaceChildren();view=null;ct.textContent='전달 CT 보기';ct.setAttribute('aria-expanded','false');
          return null;
        }finally{if(token===generation){ct.disabled=false;biopsyButton.disabled=!r.biopsyCandidate;}}
      }
      function closeViewer(){
        if(view){view.close();view=null;}
        host.hidden=true;biopsyActive=false;biopsyButton.setAttribute('aria-pressed','false');
        ct.textContent='전달 CT 보기';ct.setAttribute('aria-expanded','false');
      }
      // The biopsy marker layer only exists inside a verified viewer, so the toggle
      // reuses the same fail-closed binding check instead of mounting a second one.
      async function toggleCt(){if(view){closeViewer();return;}await openViewer();}
      async function toggleBiopsy(){
        if(biopsyActive){biopsyActive=false;biopsyButton.setAttribute('aria-pressed','false');view?.setCandidates([],null);return;}
        const opened=await openViewer();
        if(!opened||!r.biopsyCandidate)return;
        biopsyActive=true;biopsyButton.setAttribute('aria-pressed','true');
        opened.setCandidates([r.biopsyCandidate],r.biopsyCandidate.candidateId);
      }
      const ctActions=el('div','','md-record-ct-actions');ctActions.append(ct,biopsyButton);card.append(ctActions);
      if(r.viewpoint != null)ct.click(); // Restore attached views after the same fail-closed binding check.
    }else{imageStatus.textContent='CT 없음 · 합성 워크플로 시연에는 실제 CT/마스크가 없습니다.';}
    // The MD picked a guidance route, so the receiver gets the preparation that follows
    // from that choice. The checklist is demo wording, never this hospital's protocol.
    if(r.biopsyProtocol){
      const protocol=el('section','','md-record-protocol');
      const guide=MD.protocolGuide(r.biopsyProtocol);
      const protocolBody=el('div','','md-record-protocol-body');protocolBody.hidden=true;
      const protocolButton=button('조직검사 프로토콜 보기',()=>{
        protocolBody.hidden=!protocolBody.hidden;
        protocolButton.setAttribute('aria-expanded',String(!protocolBody.hidden));
        protocolButton.textContent=protocolBody.hidden?'조직검사 프로토콜 보기':'조직검사 프로토콜 접기';
      },'md-record-protocol-button');
      protocolButton.setAttribute('aria-expanded','false');
      if(guide){
        const steps=el('ul');for(const line of guide.steps)steps.append(el('li',line));
        protocolBody.append(el('p','선택 프로토콜 · '+guide.label+' · '+guide.title,'md-record-protocol-title'),
          el('p','적합 예시 · '+guide.fit,'md-record-protocol-line'),steps,
          el('p','기관 확인 필요 · '+guide.confirm,'md-record-protocol-confirm'),
          el('p',guide.authority+' · 절차 판단은 담당 의료진이 합니다.','md-record-protocol-note'));
      }else{
        protocolBody.append(el('p','프로토콜 안내 문구를 이 버전에서 읽을 수 없습니다. 기록된 값: '+String(r.biopsyProtocol),'md-record-protocol-note'));
      }
      protocol.append(el('h3','조직검사 진행 방법'),protocolButton,protocolBody);
      card.append(protocol);
    }
    // Studies shown as one patient's series are a demo grouping (MD.seriesFor), so
    // identity stays labelled unverified and every date stays labelled assumed.
    if(r.series&&Array.isArray(r.series.studies)&&r.series.studies.length){
      const series=el('section','','md-record-series');
      series.append(el('h3','환자 시리즈(시연 가정) · '+(r.series.patientId||'시리즈 미확인')));
      const seriesChips=el('div','','md-record-series-chips');
      const seriesStatus=el('p','','md-record-series-status');seriesStatus.setAttribute('role','status');
      seriesStatus.textContent='시리즈 짝은 시연 구성입니다. 환자 이력·경과 판단에 쓰지 마세요.';
      const seriesHost=el('div','','md-record-series-viewer');seriesHost.hidden=true;
      async function openSeriesStudy(study,chip){
        if(seriesView){seriesView.close();seriesView=null;}
        seriesHost.hidden=true;seriesHost.replaceChildren();
        if(study.relation==='current'){seriesStatus.textContent='이 검사는 위의 전달 CT 버튼으로 확인합니다 · 전송 시점 바인딩을 통과한 경우에만 표시됩니다.';return;}
        if(!study.viewable){seriesStatus.textContent=study.alias+' 영상을 열 수 없습니다. 이 서버가 제공하는 자산 목록에 이 검사가 없습니다. 추정 근거와 표시 촬영일은 그대로 남습니다.';return;}
        chip.disabled=true;seriesStatus.textContent='현재 자료 목록에서 '+study.alias+' 확인 중…';
        try{
          const response=await fetch('/data/model_compare/manifest.json',{cache:'no-store'});
          if(!response.ok)throw Error('manifest unavailable');
          const raw=await response.json();
          const entry=Array.isArray(raw?.cases)?raw.cases.find(x=>x?.id===study.alias):null;
          if(!entry||!Array.isArray(entry.slices)||!entry.slices.length||entry.slices.some(s=>typeof s?.ct!=='string'))throw Error('unexpected shape');
          if(token!==generation)return;
          seriesHost.hidden=false;
          seriesView=MDViewer.mount(seriesHost,{id:entry.id,slices:entry.slices.map(s=>({ct:s.ct}))},['ct'],null);
          seriesHost.querySelector('canvas')?.setAttribute('aria-label',entry.id+' '+study.label+' · 모델 오버레이 없음 · 방향키 절편 이동');
          if(Number.isInteger(entry.defaultSlice))seriesView.setSlice(entry.defaultSlice);
          seriesStatus.textContent=entry.id+' · '+entry.slices.length+'절편 · CT만 표시 · 현재 데이터 연결 표시(전송 시점 스냅샷 아님) · 표시 촬영일 '+(study.assumedDate||'기록 없음')+'(가정)';
        }catch(_){
          if(token!==generation)return;
          seriesView=null;seriesHost.hidden=true;seriesHost.replaceChildren();
          seriesStatus.textContent=study.alias+' 영상을 열 수 없습니다. 현재 자료 목록에서 확인하지 못했습니다. 추정 근거와 표시 촬영일은 그대로 남습니다.';
        }finally{if(token===generation)chip.disabled=false;}
      }
      for(const study of r.series.studies){
        if(study.relation==='current'){seriesChips.append(el('p',study.label+' · '+study.alias,'md-record-series-current'));continue;}
        const chip=button(study.label+' · '+study.alias+(study.assumedDate?' · '+study.assumedDate+'(가정)':''),()=>openSeriesStudy(study,chip),'md-record-series-chip');
        chip.dataset.seriesRelation=study.relation;
        seriesChips.append(chip);
      }
      series.append(seriesChips,seriesStatus,seriesHost,el('p',(r.series.basis||'')+' · 동일 환자 신원 미검증 · 촬영일은 시연 가정값','md-record-series-note'));
      card.append(series);
    }
    // A same-source earlier study is an inferred pairing for the demo, not a verified
    // patient history, so the label states the basis and refuses to imply chronology.
    if(!r.series&&r.priorStudy){
      const prior=el('section','','md-prior-study');
      prior.append(el('h3','이전 CT로 추정되는 검사'),
        el('p',`추정 짝 · 검증된 이전 검사 아님 · 표시 사례 식별자 ${r.priorStudy.alias} · CT만 표시`,'md-prior-note'),
        el('p',r.priorStudy.basis,'md-prior-note'),
        el('p',`표시 촬영일 ${r.priorStudy.assumedDate||'기록 없음'}${r.priorStudy.dateIsAssumed?' · 시연용 가정값 · 실제 촬영일 아님':''}`,'md-prior-note'));
      const priorStatus=el('p','','md-prior-status');priorStatus.setAttribute('role','status');
      priorStatus.textContent='같은 원본에서 만든 추정 짝입니다. 환자 이력·경과 판단에 쓰지 마세요.';
      const priorHost=el('div','','md-prior-viewer');priorHost.hidden=true;
      async function togglePrior(){
        if(priorView){priorView.close();priorView=null;priorHost.hidden=true;priorButton.textContent='이전 CT(추정) 보기';priorButton.setAttribute('aria-expanded','false');return;}
        priorButton.disabled=true;priorStatus.textContent='추정 짝 영상을 확인 중…';
        try{
          const response=await fetch('/'+String(r.priorStudy.manifestPath||'').replace(/^\/+/,''),{cache:'no-store'});
          if(!response.ok)throw Error('manifest unavailable');
          const raw=await response.json();
          const entry=Array.isArray(raw?.cases)?raw.cases.find(x=>x?.id===r.priorStudy.alias):null;
          if(!entry||!Array.isArray(entry.slices)||!entry.slices.length||entry.slices.some(s=>typeof s?.ct!=='string'))throw Error('unexpected shape');
          if(token!==generation)return;
          priorHost.hidden=false;
          priorView=MDViewer.mount(priorHost,{id:entry.id,slices:entry.slices.map(s=>({ct:s.ct}))},['ct'],null);
          priorHost.querySelector('canvas')?.setAttribute('aria-label',`${entry.id} 이전 CT로 추정되는 검사 · 모델 오버레이 없음 · 방향키 절편 이동`);
          priorButton.textContent='이전 CT(추정) 접기';priorButton.setAttribute('aria-expanded','true');
          priorStatus.textContent=`${entry.slices.length}절편 · CT만 표시 · 모델 오버레이 없음 · 추정 짝`;
        }catch(_){
          if(token!==generation)return;
          priorView=null;priorHost.hidden=true;priorHost.replaceChildren();
          // The integrated server's exact asset allowlist covers data/model_compare only,
          // so a real_cases study is refused here by design, not by a broken link.
          priorStatus.textContent='추정 짝 영상을 열 수 없습니다. 이 서버가 제공하는 자산 목록에 이 검사가 없습니다. 추정 근거와 표시 촬영일은 그대로 남습니다.';
        }finally{if(token===generation)priorButton.disabled=false;}
      }
      const priorButton=button('이전 CT(추정) 보기',()=>togglePrior(),'md-prior-button');
      priorButton.setAttribute('aria-expanded','false');
      prior.append(priorButton,priorStatus,priorHost);
      card.append(prior);
    }
    card.append(host,reference);
    const ackText=state.receipts[r.id]?'수신 확인됨 · '+state.receipts[r.id]:'수신 확인 (진료 판단 아님)';
    if(mode==='inbox'){
      const ack=button(ackText,()=>{try{store.receipt(r.id);render();status.textContent='수신 확인 저장 완료 · 진료 판단 아님';}catch(_){status.textContent='수신 확인 저장 실패 · 재시도하세요.';}},'md-record-receipt');
      ack.disabled=!!state.receipts[r.id];card.append(ack);
    }else card.append(el('p',state.receipts[r.id]?ackText:'수신 미확인'),link('수신 화면에서 이 기록 보기',MD.recordLink(scope,r.id,'inbox'),'md-record-receiver-link'));
    root.append(card);
  }
  window.addEventListener('hashchange',render);window.addEventListener('storage',render);render();
})();
