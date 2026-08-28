import './globals.css';

export const metadata = {
  title: 'YouTube Insight Monitor',
  description: 'YouTube 최신 영상을 Gemini로 분석합니다.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
