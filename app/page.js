'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Home() {
  const [query, setQuery] = useState('');
  const [channel, setChannel] = useState(null);
  const [videos, setVideos] = useState([]);
  const [analyses, setAnalyses] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [formatFilter, setFormatFilter] = useState('all');
  const [session, setSession] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedItems, setSavedItems] = useState([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) loadSaved(nextSession.user.id);
      else setSavedItems([]);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('yt-monitor-state') || '{}');
      if (saved.channel) setChannel(saved.channel);
      if (saved.videos) setVideos(saved.videos);
    } catch {}
  }, []);

  useEffect(() => {
    if (channel || videos.length) localStorage.setItem('yt-monitor-state', JSON.stringify({ channel, videos }));
  }, [channel, videos]);

  useEffect(() => {
    if (session?.user?.id) loadSaved(session.user.id);
  }, [session?.user?.id]);

  const counts = useMemo(() => ({
    all: videos.length,
    long: videos.filter(v => v.format === 'long').length,
    short: videos.filter(v => v.format === 'short').length,
  }), [videos]);

  const filteredVideos = useMemo(() => (
    formatFilter === 'all' ? videos : videos.filter(v => v.format === formatFilter)
  ), [videos, formatFilter]);

  async function loadSaved() {
    setSavedLoading(true);
    const { data, error } = await supabase
      .from('video_analyses')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (!error) {
      setSavedItems(data || []);
      const mapped = {};
      for (const row of data || []) {
        mapped[row.video_id] = {
          summary: row.summary || [],
          importance: row.importance,
          urgency: row.urgency,
          teachingValue: row.teaching_value,
          teachingIdea: row.teaching_idea,
          keywords: row.keywords || [],
          fromDb: true,
        };
      }
      setAnalyses(prev => ({ ...prev, ...mapped }));
    }
    setSavedLoading(false);
  }

  async function addChannel(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await fetch('/api/channel?q=' + encodeURIComponent(query.trim()));
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '채널을 찾지 못했습니다.');
      setChannel(data.channel);
      const vr = await fetch('/api/videos?channelId=' + encodeURIComponent(data.channel.id));
      const vd = await vr.json();
      if (!vr.ok) throw new Error(vd.error || '영상을 불러오지 못했습니다.');
      setVideos(vd.videos || []);
      setFormatFilter('all');
      setQuery('');

      if (session?.user) {
        const { error: saveError } = await supabase.from('user_channels').upsert({
          user_id: session.user.id,
          channel_id: data.channel.id,
          title: data.channel.title,
          custom_url: data.channel.customUrl || null,
          thumbnail: data.channel.thumbnail || null,
        }, { onConflict: 'user_id,channel_id' });
        if (!saveError) setNotice('채널이 Supabase에 저장되었습니다.');
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function analyze(video) {
    if (!session?.user) {
      setAuthOpen(true);
      setNotice('로그인하면 Gemini 분석 결과를 Supabase에 저장할 수 있습니다.');
      return;
    }

    setAnalyses(a => ({ ...a, [video.id]: { loading: true } }));
    setNotice('');
    try {
      const { data: existing } = await supabase
        .from('video_analyses')
        .select('*')
        .eq('video_id', video.id)
        .maybeSingle();

      if (existing) {
        const cached = rowToAnalysis(existing);
        setAnalyses(a => ({ ...a, [video.id]: { ...cached, fromDb: true } }));
        setNotice('기존 분석 결과를 Supabase에서 불러왔습니다.');
        return;
      }

      const r = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ video }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '분석에 실패했습니다.');

      const a = data.analysis;
      const { error: saveError } = await supabase.from('video_analyses').upsert({
        user_id: session.user.id,
        channel_id: channel?.id || '',
        video_id: video.id,
        title: video.title,
        video_url: video.url,
        thumbnail: video.thumbnail || null,
        published_at: video.publishedAt || null,
        views: video.views || null,
        duration: video.durationLabel || video.duration || null,
        format: video.formatLabel || (video.format === 'short' ? '숏폼' : '롱폼'),
        summary: a.summary || [],
        importance: a.importance || null,
        urgency: a.urgency || null,
        teaching_value: a.teachingValue || null,
        teaching_idea: a.teachingIdea || null,
        keywords: a.keywords || [],
        raw_analysis: a,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,video_id' });
      if (saveError) throw new Error('분석은 완료됐지만 저장에 실패했습니다: ' + saveError.message);

      setAnalyses(prev => ({ ...prev, [video.id]: a }));
      setNotice('Gemini 분석 결과를 Supabase에 저장했습니다.');
      await loadSaved();
    } catch (e) {
      setAnalyses(a => ({ ...a, [video.id]: { error: e.message } }));
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    setSavedOpen(false);
    setNotice('로그아웃했습니다.');
  }

  return <main>
    <header>
      <div><span className="eyebrow">AI VIDEO RESEARCH</span><h1>YouTube Insight Monitor</h1><p>관심 채널의 최신 영상을 가져와 Gemini가 실제 영상을 분석하고 Supabase에 저장합니다.</p></div>
      <div className="headerActions">
        {session ? <>
          <button className="savedBtn" onClick={()=>{setSavedOpen(true);loadSaved();}}>저장 내역 <span>{savedItems.length}</span></button>
          <button className="accountBtn" onClick={logout}>{session.user.email} · 로그아웃</button>
        </> : <button className="loginBtn" onClick={()=>setAuthOpen(true)}>로그인 / 회원가입</button>}
        <div className="status"><i></i> YouTube + Gemini + Supabase</div>
      </div>
    </header>

    <section className="searchbox">
      <form onSubmit={addChannel}><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="채널명, @핸들 또는 YouTube 채널 URL"/><button disabled={busy}>{busy?'불러오는 중…':'채널 등록'}</button></form>
      <small>예: @GoogleDeepMind · 채널 URL · 채널명</small>
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}
    </section>

    {channel && <section className="channel"><img src={channel.thumbnail} alt=""/><div><b>{channel.title}</b><span>{channel.customUrl || channel.id}</span></div><button onClick={()=>{setChannel(null);setVideos([]);setAnalyses({});setFormatFilter('all');localStorage.removeItem('yt-monitor-state')}}>화면에서 지우기</button></section>}

    <section className="content">
      <div className="sectionTitle"><div><h2>최신 영상</h2><p>{channel ? `${channel.title}의 최근 업로드` : '먼저 관심 YouTube 채널을 등록하세요.'}</p></div>{videos.length>0 && <strong>{filteredVideos.length} / {videos.length}개</strong>}</div>
      {videos.length>0 && <div className="formatFilters" role="group" aria-label="영상 형식 필터">
        <button className={formatFilter==='all'?'active':''} onClick={()=>setFormatFilter('all')}>전체 <span>{counts.all}</span></button>
        <button className={formatFilter==='long'?'active':''} onClick={()=>setFormatFilter('long')}>롱폼 <span>{counts.long}</span></button>
        <button className={formatFilter==='short'?'active':''} onClick={()=>setFormatFilter('short')}>숏폼 <span>{counts.short}</span></button>
      </div>}
      <div className="grid">{filteredVideos.map(v => { const a=analyses[v.id]; return <article key={v.id}>
        <a className="thumb" href={v.url} target="_blank" rel="noreferrer"><img src={v.thumbnail} alt=""/><span>▶</span><em className={`formatBadge ${v.format}`}>{v.formatLabel}</em><b className="durationBadge">{v.durationLabel}</b></a>
        <div className="cardbody"><div className="meta">{v.publishedAt} · 조회 {v.views} · {v.formatLabel}</div><h3>{v.title}</h3>
          {!a && <button className="analyze" onClick={()=>analyze(v)}>✦ Gemini로 영상 분석 + 저장</button>}
          {a?.loading && <div className="loading">Gemini가 영상과 음성을 분석하고 있습니다…</div>}
          {a?.error && <div className="error">{a.error}</div>}
          {a && !a.loading && !a.error && <Analysis analysis={a}/>} 
        </div></article>})}</div>
    </section>

    {authOpen && <AuthModal onClose={()=>setAuthOpen(false)} onDone={(message)=>{setAuthOpen(false);setNotice(message);}}/>}
    {savedOpen && <SavedDrawer items={savedItems} loading={savedLoading} onClose={()=>setSavedOpen(false)}/>} 
  </main>;
}

function rowToAnalysis(row) {
  return {
    summary: row.summary || [], importance: row.importance, urgency: row.urgency,
    teachingValue: row.teaching_value, teachingIdea: row.teaching_idea, keywords: row.keywords || []
  };
}

function Analysis({ analysis:a }) {
  return <div className="analysis">
    {a.fromDb && <div className="dbBadge">✓ Supabase 저장됨</div>}
    <h4>핵심 3줄</h4><ol>{(a.summary||[]).map((s,i)=><li key={i}>{s}</li>)}</ol>
    <div className="scores"><Score name="중요도" value={a.importance?.score}/><Score name="긴급도" value={a.urgency?.score}/><Score name="강의 활용도" value={a.teachingValue?.score}/></div>
    <p className="reason"><b>강의 활용</b> {a.teachingValue?.reason}</p>{a.teachingIdea && <p className="idea">💡 {a.teachingIdea}</p>}
    <div className="tags">{(a.keywords||[]).map(k=><span key={k}>{k}</span>)}</div>
  </div>;
}

function Score({name,value}) { return <div><span>{name}</span><b>{value || '-'}<small>/5</small></b></div> }

function AuthModal({ onClose, onDone }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault(); setWorking(true); setError('');
    const result = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    setWorking(false);
    if (result.error) return setError(result.error.message);
    if (mode === 'signup' && !result.data.session) return onDone('회원가입 완료. 이메일 인증 후 로그인해 주세요.');
    onDone(mode === 'login' ? '로그인되었습니다.' : '회원가입과 로그인이 완료되었습니다.');
  }

  return <div className="modalBack" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div className="authModal">
    <button className="closeBtn" onClick={onClose}>×</button><h2>{mode==='login'?'로그인':'회원가입'}</h2><p>분석 결과와 관심 채널을 내 계정에 저장합니다.</p>
    <form onSubmit={submit}><label>이메일<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>비밀번호<input type="password" required minLength="6" value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<div className="error">{error}</div>}<button className="primaryBtn" disabled={working}>{working?'처리 중…':mode==='login'?'로그인':'회원가입'}</button></form>
    <button className="switchBtn" onClick={()=>{setMode(mode==='login'?'signup':'login');setError('');}}>{mode==='login'?'처음이신가요? 회원가입':'이미 계정이 있나요? 로그인'}</button>
  </div></div>;
}

function SavedDrawer({ items, loading, onClose }) {
  return <div className="drawerBack" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><aside className="drawer"><div className="drawerHead"><div><h2>저장 내역</h2><p>Supabase에 저장된 Gemini 분석 결과</p></div><button className="closeBtn" onClick={onClose}>×</button></div>
    {loading ? <div className="loading">저장 내역을 불러오는 중…</div> : items.length===0 ? <div className="empty">아직 저장된 분석이 없습니다.</div> : <div className="savedList">{items.map(item=><a key={item.id} className="savedItem" href={item.video_url} target="_blank" rel="noreferrer"><img src={item.thumbnail} alt=""/><div><span>{item.format} · {item.published_at}</span><b>{item.title}</b><small>중요도 {item.importance?.score||'-'} · 긴급도 {item.urgency?.score||'-'} · 강의 활용도 {item.teaching_value?.score||'-'}</small></div></a>)}</div>}
  </aside></div>;
}
