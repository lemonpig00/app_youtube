import { NextResponse } from 'next/server';

const YT='https://www.googleapis.com/youtube/v3';
export async function GET(req){
 try{
  const key=process.env.YOUTUBE_API_KEY; if(!key) throw new Error('YOUTUBE_API_KEY가 설정되지 않았습니다.');
  const q=new URL(req.url).searchParams.get('q')?.trim(); if(!q) return NextResponse.json({error:'채널을 입력하세요.'},{status:400});
  let id='';
  const m=q.match(/youtube\.com\/channel\/([\w-]+)/); if(m) id=m[1];
  let data;
  if(id){ data=await api(`${YT}/channels?part=snippet,contentDetails&id=${id}&key=${key}`); }
  else {
   const handle=(q.match(/youtube\.com\/@([^/?]+)/)?.[1] || (q.startsWith('@')?q.slice(1):''));
   if(handle){ data=await api(`${YT}/channels?part=snippet,contentDetails&forHandle=${encodeURIComponent(handle)}&key=${key}`); }
   if(!data?.items?.length){ const s=await api(`${YT}/search?part=snippet&type=channel&maxResults=1&q=${encodeURIComponent(q)}&key=${key}`); const cid=s.items?.[0]?.snippet?.channelId || s.items?.[0]?.id?.channelId; if(cid) data=await api(`${YT}/channels?part=snippet,contentDetails&id=${cid}&key=${key}`); }
  }
  const c=data?.items?.[0]; if(!c) return NextResponse.json({error:'YouTube 채널을 찾지 못했습니다.'},{status:404});
  return NextResponse.json({channel:{id:c.id,title:c.snippet.title,customUrl:c.snippet.customUrl||'',thumbnail:c.snippet.thumbnails?.medium?.url||c.snippet.thumbnails?.default?.url,uploads:c.contentDetails?.relatedPlaylists?.uploads}});
 }catch(e){return NextResponse.json({error:e.message},{status:500})}
}
async function api(url){const r=await fetch(url,{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error?.message||'YouTube API 오류');return d}
