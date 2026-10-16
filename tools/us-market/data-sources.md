# 大行业数据源研究（2026-10-15）

本轮仅读取公开文档，未发送新行情API请求，FMP新增调用0次。现有真实快照与请求计数不改动。

| 候选 | 口径 | 文档核实情况 | 本轮处理 | 后续验证预算建议 |
| --- | --- | --- | --- | --- |
| S&P Dow Jones Indices | 官方S&P 500行业指数 | 有官方数据及许可产品；本轮未确认免费、稳定、可在本地程序保存并定时采集的11行业接口。官方免责声明对复制、保存、分发有要求，不能把网页可见等同于API授权 | 不接入 | 尚无明确获准接口，不探测 |
| SSGA / Select Sector SPDR | 11只SPDR行业ETF，属于代理指标而非行业指数本身 | 官方产品页可查看产品和下载资料，但本轮未确认适合当前采集器的免费稳定接口、机器采集权限和完整11只产品的统一日期覆盖 | 不抓取页面隐藏接口 | 先明确接口与许可，再确定样本预算 |
| Alpha Vantage | ETF相邻收盘价涨跌，须明确标为ETF代理 | 官方说明多数免费接口25次/天；TIME_SERIES_DAILY compact提供最近100条原始日线，个人非商业许可可作为候选；尚未取得其账户密钥验证11只SPDR具体权限、分拆处理和日期完整性 | 候选，不称已验证可用，不接入 | 后续先2次代表性ETF样本；通过后再单独批准完整11只预算，禁止批量试错 |
| 已保存FMP行业快照 | 按交易所分类的行业平均涨跌幅 | 现有NASDAQ/NYSE各11类真实快照已验证，可零请求复用；不等于S&P 500行业指数 | 当前使用，页面持续标注“FMP交易所行业平均涨跌幅” | 本轮0次 |

来源：

- S&P数据许可：https://www.spglobal.com/spdji/en/about-us/data-index-licensing/
- S&P免责声明：https://www.spglobal.com/spdji/en/disclaimers/
- SSGA技术行业ETF官方页：https://www.ssga.com/us/en/individual/etfs/state-street-technology-select-sector-spdr-etf-xlk
- Alpha Vantage免费额度：https://www.alphavantage.co/support/
- Alpha Vantage日线说明：https://www.alphavantage.co/documentation/#daily
- Alpha Vantage使用条款：https://www.alphavantage.co/terms_of_service/

## 当前看板口径

默认“大行业总览”展示NASDAQ的全部11类，可切换NYSE的11类。不平均、合并不同交易所记录。上涨/下跌全部展示，持平独立展示。六个速览值分别来自真实的科技、医疗、可选消费、必需消费、能源及金融行业记录，不合成“消费指数”。

“细分行业TOP5”保留两个交易所全部255条本地记录，可按两交易所/NASDAQ/NYSE过滤。同名行业保留交易所身份。大行业点击下钻使用mappings.json中本地维护的相关分类，仅过滤原记录，绝不合成细分行情或行业涨跌。

将来如接入S&P官方指数或SPDR ETF，应建立独立且完整的数据集，验证交易日期、相邻收盘价及拆分口径，并明确来源；不得缺项时以FMP平均值补位混排。


## SOX数据源验证（v1.4.0-dev.5，2026-10-15）

本节仅涉及费城半导体指数，不改变行业数据口径。FMP已知^SOX日线402，本轮不重复测试，FMP新增请求0次。

| 来源/路径 | 本轮真实结果 | 使用判断 |
| --- | --- | --- |
| Nasdaq Global Indexes / SOX概览 | 官网公开页显示2026-10-14收盘11,684.38、变动-4.30%；用于人工核对。另一Nasdaq历史页此次读取显示暂无数据表 | 未确认免费稳定且明确允许本程序采集的官方API，不探测隐藏接口 |
| FRED / NASDAQSOX公开CSV | 无密钥GET，HTTP 200，application/csv。仅1次真实数据请求，保存样本后所有开发使用本地或Mock | 当前本机个人测试采用。原始提供方Nasdaq，FRED为分发入口；公开下载不等于公开再分发许可，也不保证接口长期稳定 |
| FRED正式series/observations API | 官方文档要求注册API Key；本轮未请求该API | 当前不需要新Key，使用已验证的公开CSV导出 |

真实验证URL：[FRED CSV](https://fred.stlouisfed.org/graph/fredgraph.csv?id=NASDAQSOX&cosd=2026-10-01&coed=2026-10-14)。下载于2026-10-15T06:56:26.864Z（北京时间14:56:26），覆盖2026-10-01—2026-10-14共10条日线。10-13收盘12,208.79、10-14收盘11,684.38，计算(11,684.38 / 12,208.79 - 1) × 100 = -4.29534786…%，显示-4.30%。不使用网站的实时变动字段进行计算，不使用ETF代理。网页核对采用打开后的实际日期和值，不采用搜索摘要中可能尚未同步的盘中值。

FRED序列说明标注来源Nasdaq、Daily、Index、版权Copyright © 2025, NASDAQ, Inc.。FRED条款提供个人非商业使用及下载许可，带版权的第三方序列用于其他用途需联系版权方；保留来源和版权，不代表可公开部署、商用或再分发。当前项目严格限制为127.0.0.1本机验收，不对外发布行情。未对Yahoo、Stooq等再作批量探测，因为已获得满足本轮个人本地使用要求的样本。

实现与预算：独立scripts/collect-sox.js，默认每日最多2次FRED请求、每次手动调用最多1次且不自动重试；同日已有相邻收盘价则跳过。此次验证已计入独立本机账本（1次）。不占FMP的每日250次额度。原FMP采集器及7次预算不变。页面只读本机sox.json，历史选择和界面测试不会触发FRED或FMP。

校验：交易日历范围与现有项目一致（2024—2028）；拒绝非交易日有效记录、重复日期、非正/非法收盘价、来源或时间无效；CSV的点号/空白是缺失值。必须有相邻有效交易日收盘才能计算，缺日不跨越。每条记录保留实际获取时间，合并历史不把新时间改写到旧记录。SOX晚于所选历史日期的记录不展示，落后则标注旧数据与实际日期，缺数据保留占位。

官方参考：

- [FRED NASDAQSOX序列及版权](https://fred.stlouisfed.org/series/NASDAQSOX)
- [FRED个人使用与第三方版权条款](https://fred.stlouisfed.org/legal/)
- [FRED公开CSV下载说明](https://fred.stlouisfed.org/help/data/downloading/using-the-download-data-link/)
- [FRED正式API与Key要求](https://fred.stlouisfed.org/docs/api/fred/series_observations.html)
- [Nasdaq SOX官网核对](https://indexes.nasdaq.com/Index/Overview/SOX)
- [Nasdaq历史页](https://www.nasdaq.com/market-activity/index/sox/historical)
- [Nasdaq官网使用条款](https://www.nasdaq.com/legal)


### dev.6署名复核与显示精简

2026-10-15重新核对[FRED条款](https://fred.stlouisfed.org/legal/)、[NASDAQSOX序列署名](https://fred.stlouisfed.org/series/NASDAQSOX)及[Nasdaq条款](https://www.nasdaq.com/legal)。仅核对说明页，未重下CSV、未请求FMP或FRED行情接口。仍保持本机个人测试范围，不新增公开分发授权。

FRED要求说明经其获取数据并保留第三方版权；因此可删去每张卡片重复的来源/日期和底部长获取时间，但保留统一来源行、FRED序列链接、Copyright © 2025, NASDAQ, Inc.完整文字。本机JSON原来源、每条交易日和获取时间不改动；时间也保留在卡片标题中供核对。

来源行不再承担状态提示：四张卡片按所选交易日期各自显示延迟标签与实际日期；正常卡片无日期，缺失卡片不冒用旧行情，未来行情不进入历史。FMP采集默认严格校验不变，页面读取单项失败时只将该卡片置为暂无数据，不影响行业数据。历史快照本身不作修改。


## NBI、黄金、Brent验证（dev.7，2026-10-15）

先查阅官方文档，再进行单次验证，共3次真实行情/权限请求，无重试；FMP、SOX新增0次。原始CSV和请求记录保存在被忽略的local-data/us-market/，预算上限3，现已用完，不再追加探测。

| 候选 | 验证结果 | 正式页面处理 |
| --- | --- | --- |
| [FRED NASDAQNBI](https://fred.stlouisfed.org/series/NASDAQNBI) | CSV免Key，HTTP 200，共10条有效日线。10-14收盘6,869.64，10-13收盘6,764.22，(6869.64/6764.22-1)×100=+1.56%。获取时间2026-10-15T08:01:23.528Z | 接入；Nasdaq经FRED，指数相邻美股交易日收盘口径；保留Nasdaq版权，只作个人本机测试 |
| [Gold API文档](https://gold-api.com/llms.txt) | 免费实时报价免Key，但不含可验证的前期日收盘。history按日提供max/min/avg聚合，不能冒充收盘；OHLC及history需x-api-key，官方定价标免费账户10次/小时。单次无Key OHLC请求返回401，无重试 | 国际黄金保留待接入，USD/oz；不调用即时价格填充历史，也不虚构涨跌幅。免费是否可用仍需新Key实测；未认定为只能付费 |
| [FRED DCOILBRENTEU](https://fred.stlouisfed.org/series/DCOILBRENTEU) | CSV免Key，HTTP 200，8条有效日线。请求范围09-25—10-14，但最新仅10-06为125.44，前期10-05为125.51，变动-0.06%。获取时间2026-10-15T08:01:24.547Z | 接入EIA欧洲Brent现货日价，明确滞后10-06，USD/bbl；不称WTI、ETF或不加说明的拼接期货 |

黄金额外核对：[免费定价](https://gold-api.com/pricing)显示历史/OHLC免费额度每小时10次，不能把401误判为付费限制；[使用条款](https://gold-api.com/terms)允许应用展示和商业使用，禁止滥用。文档列出报价更新时间updatedAt，但未明确披露各实际报价供应商或统一日收盘的时区/市场边界；本轮也未取得有效Key访问两个日窗口，因此未完成真实日收盘、前一交易日、更新及时性的验证。不以其openCloseChangePercent或聚合均价替代日收盘涨幅。唯一权限请求为 /ohlc/XAU（2026-10-13 UTC起至10-14 UTC），不含密钥。

原油额外核对：[EIA原始Spot Prices表](https://www.eia.gov/dnav/pet/pet_pri_spt_s1_d.htm)同样最新10-06，说明此时直接查EIA也未提供更新日期。该表说明日价为daily closing spot prices，周/月/年均值由日价计算；本工具只取日频。来源口径不是某一期货合约，计算为本期现货日价相对上一有效来源发布日，不拼接合约。EIA[FRED页](https://fred.stlouisfed.org/series/DCOILBRENTEU)标Public Domain: Citation Requested，[EIA复用说明](https://www.eia.gov/about/copyrights_reuse.php)也要求区分其自产内容与第三方版权；当前保留EIA/FRED署名与原序列链接。

更及时的Brent来源：核对[ICE市场数据产品](https://status.ice.com/fixed-income-data-services/data-and-analytics/proprietary-data)与[Brent合约资料](https://www.ice.com/products/219/Brent-Crude-Futures/data?marketId=5884700)，官方行情、历史和EOD属于订阅/许可体系。本轮未确认无Key、免费且允许本程序保存展示的及时日线接口，未进行API探测或跨合约拼接。当前选用来源清楚、真实且明确标迟的EIA/FRED数据；不承诺该来源及时。

现有指数：标普与纳指沿用FMP，SOX沿用已保存FRED数据，未重复验证。道琼斯退出展示与新采集；INDEXES保留旧代码兼容历史，ACTIVE_INDEXES仅两项，新一批FMP请求降为6次。历史文件及原账户请求账本不改动。

NBI、Brent分别独立本地采集与日志，每源每日2次预算、每次至多1请求，无自动重试；同日已成功核查的延迟来源也跳过。历史与离线缓存沿用原有v1键，可选extras字段只增加NBI/BRENT。只暴露nbi.json、brent.json的本地路由，不暴露日志、CSV或脚本。所有自动化测试使用Mock并阻断外部请求。


## 黄金认证复核与Brent延迟保护（dev.8，2026-10-15）

本轮只修改黄金的认证说明与Brent过期展示；六卡CSS、其他4项指数、行业数据、ETF映射、采集脚本及真实行情文件均不改动。没有新的Gold API、ICE、FMP或FRED行情请求。仅对Stooq进行1次公开日线下载验证，无重试，计入local-data/us-market/dev8-source-requests.json（本轮硬预算1次）。文档/条款网页查询不计入行情API额度。

### 黄金

- 官方[定价](https://gold-api.com/pricing)确认免费账户history与OHLC合计10次/小时，并非历史数据一律收费。
- 官方[接口文档](https://gold-api.com/llms.txt)明确/history和/ohlc/XAU都需要请求头x-api-key。dev.7无密钥请求返回401，与缺少认证一致；由于本机进程及Windows用户环境均未配置GOLD_API_KEY，本轮不重复发送无认证请求，也未声称已实测认证成功。
- 本地配置：先在Gold API注册免费账户取得Key；在Windows“编辑账户的环境变量”中新增用户变量，名称GOLD_API_KEY，值为该账户Key，然后重新启动Codex。无需修改任何项目文件，不要通过聊天发送Key。今后仅允许本地Node采集器读取环境变量，并用请求头传递，不得放入URL、日志或浏览器。当前尚无自动黄金采集，也不会因设置变量或刷新页面而请求第三方。
- /history日聚合只有max/min/avg，不能作日收盘；/ohlc提供指定时间段的close，需验证两个完整且边界一致的交易日窗口，并以close/previousClose-1计算。不得使用openCloseChangePercent。当前文档未明确统一的黄金交易日边界、具体报价供应商及日收盘发布延迟；这些仍待认证后的少量真实验证，不能直接采用默认时间段或24小时相隔报价。
- [使用条款](https://gold-api.com/terms)允许在应用/网站使用并允许商业使用，但不保证数据准确性或连续服务，禁止滥用。此许可不代表已确认报价质量与日线口径。
- Stooq候选：官方[XAUUSD页](https://stooq.com/q/?s=xauusd)、[下载说明](https://stooq.com/db/h/)及[条款入口](https://stooq.com/t/)本轮未能读取有效正文；唯一CSV请求/q/d/l/?s=xauusd&i=d&d1=20261001&d2=20261014于2026-10-15T08:25:12.815Z返回HTTP403、text/html、226字节，不是行情CSV。没有绕过限制或重试，未能确认更新日期、收盘时区或自动采集/展示许可，因此不接入。黄金仍显示暂无数据/待接入，无正式价格或收益。

### Brent

[ICE Report Center](https://status.ice.com/report/77)明确EOD CSV包为付费订阅；[官方数据许可](https://status.ice.com/fixed-income-data-services/data-and-analytics/proprietary-data)包含历史序列与公开显示许可体系。未找到可确认免费、允许本程序保存使用、能标识具体合约且及时提供相邻结算/收盘价的接口。本轮不调用ICE行情，也不采集未授权隐藏接口或将连续合约价格直接相除。

继续复用FRED/EIA的DCOILBRENTEU真实欧洲现货日价，不混入ICE期货、WTI或ETF。[EIA来源表](https://www.eia.gov/dnav/pet/pet_pri_spt_s1_d.htm)本轮网页核对仍到2026-10-06，与已有缓存一致。当前实际价125.44 USD/bbl，上一有效来源日2026-10-05为125.51，历史变动(125.44/125.51-1)×100=-0.055772…%，显示-0.06%。原获取时间2026-10-15T08:01:24.547Z不改写。FRED公开CSV未公布确定请求额度，项目仍采用手动、每源每日2次硬预算、同观察日成功后跳过、无自动重试；不为等待EIA发布反复请求。本轮该来源新增0次。

新增展示规则：按当前所选观察日期与实际来源日期计算伦敦现货工作日间隔，排除周末与英国银行假日（2024—2028已核对范围）；超过2日时，大号主数值显示“数据延迟”，不显示旧百分比作为主视觉。真实价格和日期仍明确保留，历史涨跌幅及两期价格/日期可在卡片标题与原“数据口径与覆盖”详情核对。所选2026-10-14相对10-06滞后6个工作日，须触发保护。1/2日仍可显示旧百分比，但保留延迟标签和实际日期。

日历参考：[英国官方银行假日](https://www.gov.uk/bank-holidays)、[Platts伦敦油品假日发布说明](https://www.spglobal.com/energy/en/pricing-benchmarks/our-methodology/subscriber-notes/082126-european-oil-publishing-schedule-for-uk-late-summer-bank-holiday-2026)。这是伦敦现货发布工作日的展示提示口径，并非ICE期货或EIA完整发布保证，不套用NYSE休市日；如来源有实际假日报价仍保留。日历只影响提示，不删除/补齐数据，不更改涨跌幅配对。日历超出已复核范围时不将旧涨幅作为主值。后续如接入期货，需另用对应合约及交易日历，换月后先建立同合约前收盘，不跨合约制造收益。

历史切换使用所选日期重新判断，未来记录不进入过去页面；无前期价格不计算涨跌幅，无价格显示暂无数据，不能把缺失误称为延迟。所有界面/计算测试均为本地Mock，测试阻断第三方请求。保留原始历史、浏览器缓存及localStorage键。


## 现行商品方案：东方财富浏览器直连（dev.9，2026-10-15）

按用户最终决定接入方案A，仅限本地个人测试。本节覆盖此前黄金现货日线/Brent现货的页面方案，研究及真实历史保留。四个股票指数及采集脚本完全不变，不参与商品刷新。

- COMEX黄金GC00Y、market 101，USD/金衡盎司（USD/oz）；Brent B00Y、market 112，USD/桶（USD/bbl）。均按源“当月连续”标识，不称单一固定月份或ICE官方结算。
- 接口为futsseapi.eastmoney.com/list/COMEX,NYMEX,COBOT,SGX,NYBOT,LME,MDEX,TOCOM,IPE，pageIndex=0、pageSize=2000，单次列表筛选两个代码及市场。缺失/重复/口径异常只报告失败，不自动追加分页、不重试；不会照搬AKShare1.19.1缺末页问题。公开网站token为公共选择参数，不是用户API Key或数据使用授权。
- 请求mode=cors、credentials=omit、cache=no-store、redirect=error，12秒超时。无Cookie/Referer伪造、无公共CORS代理或后台服务。每次新页面尝试一次，单页并发合并、本机记录30秒冷却，冷却计时器只解锁按钮，不发请求；手动再试同样受冷却限制。页面退出中止；离线不请求，恢复网络不自动采集。BFCache恢复视为重新进入但继续遵守冷却。
- p=报价、zjsj=昨结、zdf=百分比、zde=涨跌额。以(p/zjsj-1)×100校验zdf，两位四舍五入容差0.0051个百分点；同时检查价差与zde（0.011美元容差）。不使用qrspj昨收或开盘价，源值不一致时不发布新快照。只使用本次源报价/昨结配对，不跨日自行拼接连续合约收益；精确换月规则仍未得到供应商确认。
- utime原始Unix时间完整保留并解析，显示北京时间；fetchedAt独立标记获取时间。接口未提供可靠交易日字段，tradingDate保持null，不把自然报价日、采集日或页面美股日期当交易日。仅HH:mm:ss保留原文，日期未知；无效/未来时间不补今天，并显示时间信息不完整。真实报价即使当次获取也始终标“盘中延迟行情”；缓存另标“缓存行情”。大于20分钟的报价额外提示较旧，不代表供应商承诺固定延迟。
- 独立缓存键monster-slayer-kit:us-market:commodities:v1，包含version、lastAttemptAt、snapshot（source、kind、basis、fetchedAt、quotes）。每条有symbol/market/unit/price/previousSettlement/change/calculatedChange/changeAmount/rawQuoteTime/quoteAt/timeStatus/tradingDate。缓存状态由读取缓存、失败、离线等当前情境决定；不会将上次获取时间改成新时间。未知格式不覆盖。两品种同时验证成功才替换，失败保留最后完整有效对。旧股票及商品历史键/文件不迁移、不删除。

本轮自动化87项全部Mock，无任何真实行情请求。手动Edge验收仅1次GET，HTTP200，无重试；获取时间2026-10-15T10:42:20.292Z，两个品种报价时间均2026-10-15T10:32:19.000Z，约10分钟延迟（单次观察，不保证固定）。GC00Y=4176.6、zjsj4107.9、zdf+1.67%，计算+1.6723873512%；B00Y=104.31、zjsj106.06、zdf-1.65%，计算-1.6500094286%。金额差分别68.70、-1.75。交易日未提供，不能从这些时间推断。样本与请求账本仅在local-data/us-market/dev9，未覆盖正式历史。FMP/FRED/Gold API/Yahoo/AKShare请求均0次。

署名：卡片说明保留东方财富来源，统一区域链接[GC00Y](https://quote.eastmoney.com/globalfuture/GC00Y.html)、[B00Y](https://quote.eastmoney.com/globalfuture/B00Y.html)，说明版权属于东方财富及相关权利人。此前四指数FMP、FRED/Nasdaq及Nasdaq版权仍保留。

**发布阻断及未验证事项**：[东方财富法律声明](https://about.eastmoney.com/home/disclaimer)不能视为自动采集/复制缓存/再展示的明确许可；上游期货行情权利、页面相关CME使用限制及连续合约切换说明仍需确认。本地技术接通不等于长期自动访问或静态部署获授权。无公开承诺的API免费额度或服务保证，30秒为本项目防重复规则，不是获授配额。不得将接口可用解释为长期免费稳定承诺。Windows Edge匿名跨域已实测；iPhone Safari/PWA、移动网络和未来正式域名未实测。本轮不部署，不创建代理，也不突破访问限制。此前独立验证报告local-data/eastmoney-probe/report.md继续保留。


## dev.10验收收尾（无新增数据请求）

只澄清美股收盘更新时间与商品盘中时间，并在现有刷新说明内区分历史观察日期。商品不按股票日期过滤/改写，交易日字段仍为空；历史页面明确标注最近一次盘中报价不属于所选历史日。价格、昨结口径、源、缓存键及历史文件均不改变。

为修复页面久开后过旧提示不更新的问题，既有本地显示计时器同时负责冷却解锁与20分钟陈旧阈值提示，均不发网络请求。离开页面清理计时器和进行中的请求。该阈值仍只是保守显示规则，不是来源新鲜度保证。

本轮92项完整Mock自动化通过，验证网络失败、离线恢复、旧报价、快速点击、退出取消、历史隔离、北京时间跨日/跨年与股票源隔离。真实行情请求0次，未重复请求东方财富/FMP/FRED。iPhone Safari/PWA未实测，东方财富及上游授权未明确，仍阻断正式发布。保留前述全部来源研究与dev.9真实验收记录。


## dev.11：经用户授权的Git公开数据包

现有真实源不变：FMP的2026-10-14快照（NASDAQ/NYSE各11大行业、127/128细分行业、相邻收盘计算的标普/纳指），Nasdaq经FRED的SOX和NBI。无新行情API请求、无新增真实历史日期。公开源目录public-data/us-market/只包含白名单清单、成功状态、两补充日线和真实快照；API Key、公共接口token、预算/调用日志、用户映射及其他原始字段均不导出。保留来源URL、交易日期、收盘及前期价格/日期、获取时间和Nasdaq版权。

Windows完整原始目录local-data/us-market/继续忽略、不移动、不删除；公开副本显式Git跟踪，Netlify构建复制至dist/local-data/us-market/，旧网页数据URL不变。SHA-256清单、字段/交易日/四指数及两交易所完整性在构建前强校验；普通版本构建不调用采集器、不生成替代数据、不覆盖公开历史。缺失/损坏时拒绝该构建。新日期用node scripts/public-market-data.js --collect --stage复用现有预算和同日跳过；已有数据仅同步时去掉--collect，0次请求。

用户已明确允许这些脱敏行情JSON纳入公开Git并沿用Netlify发布，本节为当前安排；旧节的本地研究/发布阻断描述保留为历史记录。来源版权及数据局限仍保留，不将技术可用改称实时或官方统一行业指数。黄金、Brent不进入本次收盘数据包，仍是独立的东方财富盘中延迟行情与缓存。


## dev.12：东方财富四指数最新报价（仅本地验收）

详见[真实请求与口径报告](./eastmoney-index-verification.md)。SPX、纳斯达克综合（源端别名100.NDX，已核对两日IXIC历史）、SOX、NBI匿名批量fetch已在Netlify实际源的Edge跨域验证。8次真实行情请求，无重试，FMP/FRED均0次。行业未找到等价统计接口，继续使用FMP公开JSON；不混用东方财富六类个股分组。

四指数新增独立缓存与刷新，30秒防重、历史隔离、失败保留；不改写正式历史，不影响商品/计算器。卡片时间为纽约报价时间，页面行业日期保持行业收盘日；延迟未获保证，绝不把盘中报价称为正式收盘。iPhone Safari/PWA仍须真机验证，授权及稳定性风险保持记录。
