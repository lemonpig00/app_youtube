import { NextResponse } from 'next/server';
const YT='https://www.googleapis.com/youtube/v3';

export async function GET(req){
  try{
    const key=process.env.YOUTUBE_API_KEY;
    if(!key) throw new Error('YOUTUBE_API_KEY가 설정되지 않았습니다.');
    const id=new URL(req.url).searchParams.get('channelId');
    if(!id) return NextResponse.json({error:'channelId가 필요합니다.'},{status:400});

    const c=await api(`${YT}/channels?part=contentDetails&id=${id}&key=${key}`);
    const list=c.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if(!list) throw new Error('업로드 재생목록을 찾지 못했습니다.');

    const p=await api(`${YT}/playlistItems?part=snippet,contentDetails&playlistId=${list}&maxResults=12&key=${key}`);
    const ids=p.items.map(x=>x.contentDetails.videoId).join(',');
    const stats=ids?await api(`${YT}/videos?part=statistics,contentDetails&id=${ids}&key=${key}`):{items:[]};
    const sm=Object.fromEntries(stats.items.map(x=>[x.id,x]));

    const videos=p.items.map(x=>{
      const v=sm[x.contentDetails.videoId];
      const duration=v?.contentDetails?.duration||'';
      const durationSeconds=parseISODuration(duration);
      const format=durationSeconds<=180?'short':'long';
      return {
        id:x.contentDetails.videoId,
        title:x.snippet.title,
        thumbnail:x.snippet.thumbnails?.high?.url||x.snippet.thumbnails?.medium?.url,
        publishedAt:new Date(x.contentDetails.videoPublishedAt||x.snippet.publishedAt).toLocaleDateString('ko-KR'),
        views:Number(v?.statistics?.viewCount||0).toLocaleString('ko-KR'),
        duration,
        durationSeconds,
        durationLabel:formatDuration(durationSeconds),
        format,
        formatLabel:format==='short'?'숏폼':'롱폼',
        url:`https://www.youtube.com/watch?v=${x.contentDetails.videoId}`
      };
    });
    return NextResponse.json({videos});
  }catch(e){
    return NextResponse.json({error:e.message},{status:500});
  }
}

function parseISODuration(value=''){
  const m=value.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if(!m) return 0;
  return Number(m[1]||0)*3600+Number(m[2]||0)*60+Number(m[3]||0);
}

function formatDuration(total=0){
  const h=Math.floor(total/3600);
  const m=Math.floor((total%3600)/60);
  const s=total%60;
  if(h>0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

async function api(url){
  const r=await fetch(url,{cache:'no-store'});
  const d=await r.json();
  if(!r.ok) throw new Error(d.error?.message||'YouTube API 오류');
  return d;
}
