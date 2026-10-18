# 護眼設計研究筆記

這份筆記說明墨屏閱讀器每個視覺決定背後的依據與取捨。它是**設計參考，不是醫療建議**；有長期眼睛不適請找眼科或驗光師。

## 0. 前提：網頁變不成電子紙

電子紙與反射式液晶（電子雞、掌上遊戲機、計算機那種）本身不發光，是靠環境光反射來顯示。這帶來幾個對眼睛友善的特性：

- 亮度自動跟著環境走，不會比周圍刺眼；
- 沒有背光，也就沒有背光調光造成的閃爍；
- 畫面是靜態的，翻頁才更新。

網頁跑在手機或電腦的**發光螢幕**上，這些物理特性搬不過來。所以這個專案的策略是：

1. 把反射式螢幕「對眼睛友善的光學特徵」盡量模擬出來：紙色而非純白、低峰值亮度、無高光、翻頁而不捲動、夜間低藍光；
2. 避開發光螢幕的典型問題：過亮、過高對比、持續捲動、長時間不眨眼；
3. 「擬真」與「護眼」衝突時，**預設偏向護眼**，擬真效果做成可選（見第 7 節）。

## 1. 為什麼以電子紙為樣板

- Benedetto 等人（2013）讓受試者分三次長時間閱讀，比較 LCD 閱讀器（Kindle Fire HD）、E-ink 閱讀器（Kindle Paperwhite）與紙本書。LCD 造成的視覺疲勞明顯較高，**E-ink 與紙本沒有差異**。
- Chang 等人（2015）比較睡前讀發光式電子閱讀器（iPad）與讀紙本書：讀發光螢幕時褪黑激素分泌受抑制、生理時鐘延後、隔天早上較不清醒。

本專案的推論是：要接近紙本，就要讓畫面「像被照亮的紙」，而不是「一塊發光的燈板」。

## 2. 色彩與對比

### 2.1 六組色票

材質（電子紙／液晶）乘上光線（日光／暖光／夜間），共六組。數值由 `css/reader.css` 的色票計算而來；「藍色占比」是線性 sRGB 藍色通道占 R+G+B 的比例，只是**粗略指標**，不是 CIE S 026 的 melanopic 量測。

| 組合 | 背景 | 文字 | 文字對比 | 次要文字對比 | 最亮處（相對純白） | 主要發光面的藍色占比 |
|---|---|---|---|---|---|---|
| 電子紙・日光 | `#e4e1d8` | `#262522` | 11.7:1 | 5.4:1 | 75% | 31% |
| 電子紙・暖光 | `#dbc9a5` | `#2c2317` | 9.5:1 | 5.2:1 | 60% | 23% |
| 電子紙・夜間 | `#1c1a17` | `#b8ad99` | 7.8:1 | 4.5:1 | 42%（只有字） | 26% |
| 液晶・日光 | `#adb88e` | `#172012` | 8.0:1 | 4.6:1 | 45% | 23% |
| 液晶・暖光 | `#c99f5a` | `#1e1305` | 7.5:1 | 4.6:1 | 38% | 10% |
| 液晶・夜間 | `#16100a` | `#e09b42` | 8.0:1 | 4.7:1 | 40%（只有字） | 5% |
| 參考：純白底純黑字 | `#ffffff` | `#000000` | 21.0:1 | — | 100% | 33% |

設定頁底部會即時顯示目前配色的對比值與亮度。

### 2.2 原則

- **內文對比落在 7.5:1 到 12:1。** 高於 WCAG 2.x 的最高等級 AAA（SC 1.4.6，7:1），但遠低於純黑白的 21:1。次要文字（頁碼、時間、說明）至少 4.5:1（AA）。系統開啟「增加對比」（`prefers-contrast: more`）時，次要文字改用主墨色。
- **不用純白底。** 電子紙的白其實是淺灰；在發光螢幕上，大面積純白是整個畫面最亮的東西。日光模式的紙色約為純白亮度的 75%，液晶約 45%。
- **不用純黑字，也不用純白字。** 夜間模式的字是暖灰或琥珀色。暗底亮字時，字看起來會向外暈開（halation），散光的人尤其明顯；所以夜間字色壓低亮度，並加 0.02em 字距抵銷。
- **白天用正像（淺底深字）。** Buchner 與 Baumgartner（2007）發現，不論環境亮暗，正像的閱讀與校對表現都比較好；Piepenbrock 等人（2013）在年輕與年長受試者身上都得到同樣結果；Piepenbrock 等人（2014）發現字愈小，正像優勢愈大，並認為原因在於正像畫面的亮度較高，讓細節更容易看清。因此日光與暖光模式都是正像；夜間才改用負像，這時建議把字級調大一點。

## 3. 亮度與藍光

- 抑制褪黑激素最有效的波長約在 460–480 nm 的藍光區（Brainard 等人，2001；Thapan 等人，2001），CIE S 026:2018 據此定義了 melanopic 量測方法。暖光與液晶夜間（琥珀負像）就是為了在晚上降低這一段的比例。
- 但**只改色溫不夠**。Duraccio 等人（2021）的隨機試驗中，iPhone Night Shift 並沒有改善睡眠；在部分受試者裡，表現最好的是睡前完全不用手機的那組。所以這裡把「總亮度」放在色溫之前：
  - 夜間模式整片是暗底，發光的只有字，平均亮度遠低於表中的「最亮處」；
  - 設定裡有**軟體調暗**（30–100%），可以比系統的最低亮度更暗。
- **不宣稱「抗藍光保護視網膜」。** Cochrane 系統性回顧（Singh 等人，2023）找不到濾藍光鏡片能減輕視覺疲勞的短期證據，也沒有研究顯示它能保護黃斑部。這裡的暖色配色是為了**晚間的舒適與作息**，不是為了防止眼睛受傷。
- **閃爍。** 部分 OLED 螢幕在低亮度時用低頻 PWM 調光，IEEE Std 1789-2015 討論了這種光源調變對觀看者的風險。對閃爍敏感的人可以把系統亮度維持在中等，改用軟體調暗；實際效果依機型而定。
- **自動光線**依當地時間切換：06–18 日光、18–22 暖光、22–06 夜間。瀏覽器目前讀不到環境光（`AmbientLightSensor` 沒有普及），所以只能用時間來近似。

## 4. 翻頁而不捲動

- 文字分頁顯示，翻頁時**瞬間**整頁換過去，沒有滑動或淡入動畫，這就是電子紙的翻頁方式。
- 理由：捲動時眼睛得追著移動中的文字跑；而 LCD/OLED 這類「保持型」（sample-and-hold）顯示器上，被眼睛追蹤的移動影像會產生動態模糊，這是顯示工程上已知的現象。分頁讓閱讀時的文字永遠是靜止的。
- 翻頁的點擊區很大：左 30% 上一頁、右 30% 下一頁、中間叫出選單；也支援滑動、滾輪、鍵盤與機身實體鍵。
- 遵守系統的「減少動態效果」（`prefers-reduced-motion`）。眼眼的眨眼動畫每秒最多換一格，系統要求減少動態時就停在第一格。

## 5. 排版

| 項目 | 預設 | 可調範圍 | 依據 |
|---|---|---|---|
| 字級 | 20 px | 14–32 px；像素字 24／36／48 px | CSS 的 px 以視角定義（參考像素約 0.0213°），所以 20 px 在各種裝置上看起來差不多大：字身約 0.43°。Legge 與 Bigelow（2011）整理出西文的流暢閱讀區間約為 x 字高 0.2°–2°；20 px 的西文 x 字高約 0.2°，正好在下限附近。漢字筆畫比拉丁字母密得多，所以預設不低於 20 px，並鼓勵往上調。 |
| 行高 | 1.85 倍 | 1.6／1.85／2.1 | WCAG 2.x SC 1.4.12 要求排版至少能承受 1.5 倍行高；中文字填滿整個字框，需要比西文更多的行距，換行時眼睛才不容易跳錯行。 |
| 行寬 | 每行最多 34 字 | 26／34／44 字 | Dyson 與 Haselgrove（2001）發現西文螢幕閱讀約每行 55 字元時理解最好；中文沒有同等級的實證，這裡採用書籍常見的每行三十多字。 |
| 段落 | 首行縮排兩字、段距 0.3 em | 可關閉縮排 | 依 W3C《中文排版需求》（clreq）的慣例；並使用嚴格的標點禁則（`line-break: strict`）、兩端對齊。 |
| 字型 | 明體（電子紙）、像素（液晶） | 明體／黑體／楷體／像素 | 使用系統已安裝的中文字型，不另外下載。實際上：iPhone 沒有內建可用的中文明體與楷體，三種都會以蘋方（黑體）顯示；Android 的明體是 Noto Serif CJK（思源宋體），但沒有楷體。設定頁會在偵測到裝置缺字型時註明。像素字是 Fusion Pixel 12px（SIL OFL 1.1），隨專案附在 `fonts/`，各平台都一樣。 |

### 像素字對齊點陣

液晶模式選「像素」字型時，字的每一個像素都要剛好落在一個液晶點上，否則格線會把筆畫切得忽粗忽細。做法：

- 字級只能是 12 px 的整數倍（24／36／48），點距 = 字級 ÷ 12；
- 行高取偶數個字型像素，讓上下半行距都是整數個點；
- 文字欄寬取整數個全形字寬，邊界、段距也都對齊點距；
- 像素模式關掉兩端對齊、中西文自動間距與仿粗體，避免出現小數像素。

## 6. 20-20-20 休息提醒

- 盯著螢幕時，眨眼次數明顯減少（Patel 等人，1991；Tsubota 與 Nakamori，1993），這是乾眼與數位眼疲勞的主要成因之一（Sheppard 與 Wolffsohn，2018）。
- Talens-Estarelles 等人（2023）用軟體依 20-20-20 規則提醒受試者休息，兩週後數位眼疲勞與乾眼症狀都改善了；但提醒一停，一週後效果就消失。Johnson 與 Rosenfield（2023）則質疑「20 分鐘、20 英尺、20 秒」這幾個數字本身缺乏依據。
- 因此這裡把它當作**實用的提醒**而非定律：
  - 間隔可選 20／30／45 分鐘或關閉；
  - 只計算「真的在讀」的時間：閱讀頁開著、分頁在前景、三分鐘內有操作；
  - 離開超過五分鐘，就當作已經休息過，重新計時；
  - 時間到了，眼眼會出來請你看 6 公尺外 20 秒、慢慢眨幾次眼，隨時可以略過；
  - 液晶外殼左側的指示燈：綠＝剛開始、黃＝快到了、紅＝該休息了（恆亮，不閃）。

## 7. 擬真與護眼的取捨

| 擬真效果 | 預設 | 說明 |
|---|---|---|
| 紙張顆粒與斑駁 | 淡 | 用 SVG 雜訊產生，極低透明度。「擬真」會加重，「關」完全去除。 |
| 前光落差與暗角 | 淡 | 下緣略亮、四角略暗，幅度在 7% 以內。 |
| 點陣格線 | 淡 | 點與點之間透出反射板的淺色細線；只在液晶模式。 |
| 液晶反射板陰影 | 開 | 每個「墨點」往右下投一道淡影，這是反射式液晶最有辨識度的特徵；「質感：關」時一併移除。 |
| 圖片灰階化 | 開 | 電子紙 16 階灰、液晶 4 階灰，並與紙色相乘，避免照片成為畫面上最亮、最鮮豔的東西。 |
| 電子紙全刷閃爍 | **關** | 黑白各閃 70 ms。閃光對光敏感者不友善，所以預設關閉；即使打開，每秒也最多 2.5 次，低於 WCAG 2.3.1 每秒三次的上限。 |
| 液晶慢速反應殘影 | **關** | 新的一頁分四步才變深（240 ms）；預設關閉，理由同上。 |
| 裝置外殼 | 開（寬螢幕） | 外殼本身不發光、顏色跟著光線模式變暗；外框以外的桌面也是中低亮度，避免「黑底中一塊亮螢幕」的強烈落差。 |

## 8. 已知限制與下一步

- 無法讀取環境光，也無法控制硬體背光、PWM 頻率或色溫，實際色彩取決於使用者的螢幕。
- 尚未支援直排（`writing-mode: vertical-rl`）。直排是中文書的重要形式，適合當作下一步。
- iPhone 上沒有內建中文明體與楷體。若要一致的明體，得自帶網頁字型：只取 Noto Serif TC 一個字重、切成 unicode-range 分片，總共約 3 MB，實際讀一本書會下載約 2 MB。這會違背「零下載」的取捨，所以目前沒有做。
- EPUB 只保留結構（標題、段落、清單、表格、圖片、ruby 注音），刻意捨棄書本自帶的 CSS，排版由閱讀器統一控制。

## 參考文獻

1. Benedetto, S., Drai-Zerbib, V., Pedrotti, M., Tissier, G., & Baccino, T. (2013). E-readers and visual fatigue. *PLoS ONE, 8*(12), e83676. https://doi.org/10.1371/journal.pone.0083676
2. Chang, A.-M., Aeschbach, D., Duffy, J. F., & Czeisler, C. A. (2015). Evening use of light-emitting eReaders negatively affects sleep, circadian timing, and next-morning alertness. *PNAS, 112*(4), 1232–1237. https://doi.org/10.1073/pnas.1418490112
3. Buchner, A., & Baumgartner, N. (2007). Text–background polarity affects performance irrespective of ambient illumination and colour contrast. *Ergonomics, 50*(7), 1036–1063.
4. Piepenbrock, C., Mayr, S., Mund, I., & Buchner, A. (2013). Positive display polarity is advantageous for both younger and older adults. *Ergonomics, 56*(7), 1116–1124.
5. Piepenbrock, C., Mayr, S., & Buchner, A. (2014). Positive display polarity is particularly advantageous for small character sizes: Implications for display design. *Human Factors, 56*(5), 942–951.
6. Brainard, G. C., Hanifin, J. P., Greeson, J. M., et al. (2001). Action spectrum for melatonin regulation in humans: Evidence for a novel circadian photoreceptor. *Journal of Neuroscience, 21*(16), 6405–6412.
7. Thapan, K., Arendt, J., & Skene, D. J. (2001). An action spectrum for melatonin suppression: Evidence for a novel non-rod, non-cone photoreceptor system in humans. *Journal of Physiology, 535*(1), 261–267.
8. CIE S 026/E:2018. *CIE system for metrology of optical radiation for ipRGC-influenced responses to light.*
9. Duraccio, K. M., et al. (2021). Does iPhone Night Shift mitigate negative effects of smartphone use on sleep outcomes in emerging adults? *Sleep Health, 7*(4), 478–484.
10. Singh, S., Keller, P. R., Busija, L., McMillan, P., Makrai, E., Lawrenson, J. G., Hull, C. C., & Downie, L. E. (2023). Blue-light filtering spectacle lenses for visual performance, sleep, and macular health in adults. *Cochrane Database of Systematic Reviews*, CD013244.
11. IEEE Std 1789-2015. *IEEE recommended practices for modulating current in high-brightness LEDs for mitigating health risks to viewers.*
12. W3C. *Web Content Accessibility Guidelines (WCAG) 2.2*：SC 1.4.6 Contrast (Enhanced)、SC 1.4.12 Text Spacing、SC 2.3.1 Three Flashes or Below Threshold. https://www.w3.org/TR/WCAG22/
13. W3C. *Requirements for Chinese Text Layout（中文排版需求）*. https://www.w3.org/TR/clreq/
14. W3C. *CSS Values and Units Module Level 4*：reference pixel. https://www.w3.org/TR/css-values-4/#reference-pixel
15. Legge, G. E., & Bigelow, C. A. (2011). Does print size matter for reading? A review of findings from vision science and typography. *Journal of Vision, 11*(5), 8.
16. Dyson, M. C., & Haselgrove, M. (2001). The influence of reading speed and line length on the effectiveness of reading from screen. *International Journal of Human-Computer Studies, 54*(4), 585–612.
17. Patel, S., Henderson, R., Bradley, L., Galloway, B., & Hunter, L. (1991). Effect of visual display unit use on blink rate and tear stability. *Optometry and Vision Science, 68*(11), 888–892.
18. Tsubota, K., & Nakamori, K. (1993). Dry eyes and video display terminals. *New England Journal of Medicine, 328*(8), 584.
19. Sheppard, A. L., & Wolffsohn, J. S. (2018). Digital eye strain: Prevalence, measurement and amelioration. *BMJ Open Ophthalmology, 3*(1), e000146.
20. Talens-Estarelles, C., et al. (2023). The effects of breaks on digital eye strain, dry eye and binocular vision: Testing the 20-20-20 rule. *Contact Lens and Anterior Eye, 46*(2).
21. Johnson, S., & Rosenfield, M. (2023). 20-20-20 rule: Are these numbers justified? *Optometry and Vision Science, 100*(1), 52–56. https://doi.org/10.1097/OPX.0000000000001971
