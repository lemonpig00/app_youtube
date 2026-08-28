import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

export async function POST(req) {
  try {
    const auth = req.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    );
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return NextResponse.json({ error: '로그인 세션이 만료되었습니다.' }, { status: 401 });

    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
    const { video } = await req.json();
    if (!video?.url) return NextResponse.json({ error: '영상 정보가 없습니다.' }, { status: 400 });

    const ai = new GoogleGenAI({ apiKey: key });
    const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
    const prompt = `당신은 AI·디지털 활용 교육을 준비하는 전문 리서처입니다. 공개 YouTube 영상을 실제로 시청하고, 음성·화면·시연 내용을 근거로 한국어로 분석하세요.
반드시 JSON 객체 하나만 반환하세요. 마크다운 코드블록은 사용하지 마세요.
형식: {"summary":["핵심1","핵심2","핵심3"],"importance":{"score":1,"reason":"이유"},"urgency":{"score":1,"reason":"이유"},"teachingValue":{"score":1,"reason":"이유"},"teachingIdea":"강의에서 활용할 구체적 아이디어","keywords":["키워드1","키워드2","키워드3"]}
importance, urgency, teachingValue의 score는 반드시 1~5 정수입니다. summary는 정확히 3개로 작성하세요.`;

    const interaction = await ai.interactions.create({
      model,
      input: [
        { type: 'text', text: prompt },
        { type: 'video', uri: video.url }
      ]
    });

    const text = interaction.outputText || interaction.output_text;
    if (!text) throw new Error('Gemini 분석 결과가 비어 있습니다.');
    let analysis;
    try {
      analysis = JSON.parse(text.replace(/^```json\s*|\s*```$/g, '').trim());
    } catch {
      throw new Error('Gemini 분석 결과를 JSON으로 해석하지 못했습니다.');
    }
    return NextResponse.json({ analysis });
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Gemini 분석 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
