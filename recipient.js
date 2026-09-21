(function(){
  'use strict';
  const root=document.getElementById('recipientList'),status=document.getElementById('receiptStatus'),title=document.getElementById('recipientTitle');
  let generation=0,view=null;
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const link=(text,href,cls)=>{const n=el('a',text,cls);n.href=href;return n;};
  const button=(text,fn,cls)=>{const n=el('button',text,cls);n.type='button';n.onclick=fn;return n;};
  const reason=e=>{try{return MD.reason(e);}catch(_){return '전송 시점 비교 근거를 읽을 수 없습니다.';}};
  function render(){
    const token=++generation;if(view)view.close();view=null;root.replaceChildren();status.textContent='';
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
    const memo=el('section','','md-record-memo');memo.append(el('h3','MD 추가 소견·임상 메모'),el('p',typeof r.notes==='string'?(r.notes.trim()||'추가 메모가 없습니다.'):'메모 기록을 읽을 수 없습니다.'));
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
      const ct=button('전달 CT 보기',async()=>{
        if(view){view.close();view=null;host.hidden=true;ct.textContent='전달 CT 보기';return;}
        ct.disabled=true;imageStatus.textContent='보낼 때의 CT와 현재 CT가 같은지 확인 중…';card.dataset.bindingState='checking';
        try{
          const response=await fetch('/data/model_compare/manifest.json',{cache:'no-store'});
          if(!response.ok)throw Error('Manifest unavailable');
          const canonical=await MD.snapshotCase(r,await response.text(),normalizeManifest,scope);
          if(token!==generation)return;
          host.hidden=false;view=MDViewer.mount(host,canonical,r.none?['ct']:r.selected,r.viewpoint||null);
          if(r.none)host.querySelector('canvas')?.setAttribute('aria-label',`${canonical.id} CT · 모델 참고 없음 · 방향키 절편 이동`);
          card.dataset.bindingState='verified';imageStatus.textContent='보낼 때의 CT와 일치합니다 · 선택한 모델만 표시합니다';ct.textContent='전달 CT 접기';
        }catch(_){
          if(token!==generation)return;
          card.dataset.bindingState='mismatch';imageStatus.textContent='영상을 열 수 없습니다. 보낼 때의 CT와 현재 자료가 다르거나 확인할 수 없습니다. 전달 메모는 계속 볼 수 있습니다.';
          host.hidden=true;host.replaceChildren();
        }finally{if(token===generation)ct.disabled=false;}
      },'md-record-ct-button');card.append(ct);
      if(r.viewpoint != null)ct.click(); // Restore attached views after the same fail-closed binding check.
    }else{imageStatus.textContent='CT 없음 · 합성 워크플로 시연에는 실제 CT/마스크가 없습니다.';}
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
