'use client';

import { useEffect, useState } from 'react';

export default function Home() {
  const [query, setQuery] = useState('');
  const [channel, setChannel] = useState(null);
  const [videos, setVideos] = useState([]);
  const [analyses, setAnalyses] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('yt-monitor-state') || '{}');
      if (saved.channel) setChannel(saved.channel);
      if (saved.videos) setVideos(saved.videos);
      if (saved.analyses) setAnalyses(saved.analyses);
    } catch {}
  }, []);

  useEffect(() => {
    if (channel || videos.length || Object.keys(analyses).length) {
      localStorage.setItem('yt-monitor-state', JSON.stringify({ channel, videos, analyses }));
    }
  }, [channel, videos, analyses]);

  async function addChannel(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/channel?q=' + encodeURIComponent(query.trim()));
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '채널을 찾지 못했습니다.');
      setChannel(data.channel);
      const vr = await fetch('/api/videos?channelId=' + encodeURIComponent(data.channel.id));
      const vd = await vr.json();
      if (!vr.ok) throw new Error(vd.error || '영상을 불러오지 못했습니다.');
      setVideos(vd.videos || []);
      setQuery('');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function analyze(video) {
    setAnalyses(a => ({ ...a, [video.id]: { loading: true } }));
    try {
      const r = await fetch('/api/analyze', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ video }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '분석에 실패했습니다.');
      setAnalyses(a => ({ ...a, [video.id]: data.analysis }));
    } catch (e) {
      setAnalyses(a => ({ ...a, [video.id]: { error: e.message } }));
    }
  }

  return <main>
    <header><div><span className="eyebrow">AI VIDEO RESEARCH</span><h1>YouTube Insight Monitor</h1><p>관심 채널의 최신 영상을 가져와 Gemini가 핵심 내용과 강의 활용 가치를 분석합니다.</p></div><div className="status"><i></i> YouTube API + Gemini</div></header>
    <section className="searchbox">
      <form onSubmit={addChannel}><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="채널명, @핸들 또는 YouTube 채널 URL"/><button disabled={busy}>{busy?'불러오는 중…':'채널 등록'}</button></form>
      <small>예: @GoogleDeepMind · 채널 URL · 채널명</small>{error && <div className="error">{error}</div>}
    </section>
    {channel && <section className="channel"><img src={channel.thumbnail} alt=""/><div><b>{channel.title}</b><span>{channel.customUrl || channel.id}</span></div><button onClick={()=>{setChannel(null);setVideos([]);setAnalyses({});localStorage.removeItem('yt-monitor-state')}}>삭제</button></section>}
    <section className="content"><div className="sectionTitle"><div><h2>최신 영상</h2><p>{channel ? `${channel.title}의 최근 업로드` : '먼저 관심 YouTube 채널을 등록하세요.'}</p></div>{videos.length>0 && <strong>{videos.length}개</strong>}</div>
      <div className="grid">{videos.map(v => { const a=analyses[v.id]; return <article key={v.id}>
        <a className="thumb" href={v.url} target="_blank" rel="noreferrer"><img src={v.thumbnail} alt=""/><span>▶</span></a>
        <div className="cardbody"><div className="meta">{v.publishedAt} · 조회 {v.views}</div><h3>{v.title}</h3>
          {!a && <button className="analyze" onClick={()=>analyze(v)}>✦ Gemini로 영상 분석</button>}
          {a?.loading && <div className="loading">Gemini가 영상을 보고 있습니다…</div>}
          {a?.error && <div className="error">{a.error}</div>}
          {a && !a.loading && !a.error && <div className="analysis"><h4>핵심 3줄</h4><ol>{(a.summary||[]).map((s,i)=><li key={i}>{s}</li>)}</ol><div className="scores"><Score name="중요도" value={a.importance?.score}/><Score name="긴급도" value={a.urgency?.score}/><Score name="강의 활용도" value={a.teachingValue?.score}/></div><p className="reason"><b>강의 활용</b> {a.teachingValue?.reason}</p>{a.teachingIdea && <p className="idea">💡 {a.teachingIdea}</p>}<div className="tags">{(a.keywords||[]).map(k=><span key={k}>{k}</span>)}</div></div>}
        </div></article>})}</div>
    </section>
  </main>;
}

function Score({name,value}) { return <div><span>{name}</span><b>{value || '-'}<small>/5</small></b></div> }
