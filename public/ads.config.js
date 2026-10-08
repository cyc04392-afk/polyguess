// 광고 설정 (이 파일만 고치면 됩니다. 프로그래밍 지식 필요 없음)
//
// 1) 구글 애드센스(https://adsense.google.com)에 사이트를 등록하고 승인을 받으세요.
// 2) 승인 뒤 '광고 단위'를 3개 만들고(왼쪽 세로, 오른쪽 세로, 아래 가로), 아래 따옴표 안에 번호를 적으세요.
// 3) client 는 'ca-pub-' 로 시작하는 게시자 ID 입니다.
// 번호를 비워 두면 광고 대신 점선으로 '광고 자리'만 보입니다(showPlaceholders 를 false 로 바꾸면 그것도 안 보임).
window.POLYGUESS_ADS = {
  enabled: true,
  provider: 'adsense',
  client: '',
  slots: { left: '', right: '', bottom: '' },
  showPlaceholders: true,
};
