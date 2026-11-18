# うちゅうじんカメラ(再構築版)

引き継ぎ仕様書(2026-11-17)をもとに、ソースなしで作り直した静的Webアプリ。ビルド不要。

## 動かし方
- ローカル: `python3 -m http.server 8000` → http://localhost:8000/ (カメラはHTTPSかlocalhostのみ)
- 公開: GitHub Pagesなど、HTTPSの静的ホスティングにこのフォルダ一式を置く

## 構成
- `index.html` / `style.css` … 画面
- `js/app.js` … 状態管理、カメラ、外カメ簡易モード、内カメ、撮影
- `js/alien.js` … 宇宙人(まばたき・ふわふわ・五つ星)と影
- `js/xr.js` … WebXR(Android)の床固定
- `js/faces.js` … 最大3人の顔追跡(face-api tiny detector、端末内処理)
- `js/gestures.js` … ドラッグ/ピンチ/ひねり
- `assets/alien.glb` … ブラウザ用モデル  `assets/alien-ar.usdz` … iPhone AR Quick Look用
- `tools_make_usdz.py` … GLBからUSDZを作り直すスクリプト(`pip install usd-core numpy pillow`)
  `python3 tools_make_usdz.py assets/alien.glb assets/alien-ar.usdz`(スクリプト内のWORKパスは環境に合わせて変更)
- `vendor/` … three.js, face-api(同梱)

## 実機で確認すること
1. iPhone Safari: 右下「床に置いて歩く(AR)」→ Quick Look で「AR」タブに切り替わり、床に置ける
2. 同、アプリ内ブラウザで開くと案内が出て、「Safari用リンク」でURLをコピーできる
3. Android Chrome: 「床に置いて歩く(AR)」→ 床に置く→近づく/周りを歩く→同じ位置に留まる
4. 内カメ: 1〜3人で頭上に宇宙人が出る
