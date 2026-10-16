# 东方财富美股指数验证（本地开发 dev.12）

验证时间：2026-10-16 北京时间08:26—08:30。只执行必要请求，无自动重试。请求预算14，实际8次（7个HTTP200、1次连接中断）；FMP、FRED、Gold API、Yahoo、AKShare行情请求均0。官网HTML/静态JS阅读不计行情请求。

## 实际数据

| 应用身份 | 东方财富secid | 最新报价 | 昨收 | 源涨跌幅 | 纽约报价时间 | 北京时间 |
|---|---|---:|---:|---:|---|---|
| 标普500 ^GSPC |100.SPX|7744.06|7718.94|+0.33%|2026-10-15 15:59:46 EDT|2026-10-16 03:59:46|
| 纳斯达克综合 ^IXIC |100.NDX（源端别名）|26713.03|26692.87|+0.08%|2026-10-15 16:00:00 EDT|2026-10-16 04:00:00|
| 费城半导体 SOX |251.SOX|11581.22|11684.38|-0.88%|2026-10-15 16:00:00 EDT|2026-10-16 04:00:00|
| 纳斯达克生物科技 NBI |251.NBI|7004.46|6869.64|+1.96%|2026-10-15 16:00:00 EDT|2026-10-16 04:00:00|

以上是本次实际返回值，不是未来固定预期或正式收盘快照。四项以(最新报价/昨收-1)×100校验，源两位百分比误差不超过0.0051个百分点。昨收分别与已保存2026-10-14的FMP/FRED收盘值一致，无新增FMP/FRED请求。本次报价时间在纽约常规交易时段且为有效交易日，识别交易日为10-15；源本身未提供独立交易日字段。其他时段不擅自认定交易日。

单股接口字段：f43最新点位、f57代码、f58名称、f60昨收、f86报价Unix秒、f169价差、f170百分比。单股接口f124=0，不能当作时间。批量接口字段：f12代码、f13市场、f14名称、f2报价、f18昨收、f3百分比、f124报价Unix秒、f152精度。本地分别记录quoteAt与fetchedAt，不用获取日期冒充交易日。

### IXIC身份核验

100.IXIC返回HTTP200但rc=100、data=null，不能视为有效接口。官网指数列表/纳斯达克页使用100.NDX；此源端别名不可直接按标准代码解释为Nasdaq-100。

历史接口100.NDX实际返回10-13收盘27204.38、10-14收盘26692.87；两者与现有FMP ^IXIC快照中的previousClose、close完全一致，日变动-1.88%也一致。批量接口昨收26692.87再次一致。因此本地应用仍保留^IXIC身份，注明东方财富100.NDX别名，不拿Nasdaq-100替代。若新报价的昨收与同一前交易日已存IXIC收盘不符，界面回退历史FMP数据并明确提示。

官网参考：[标普](https://quote.eastmoney.com/gb/zsSPX.html)、[纳斯达克](https://quote.eastmoney.com/gb/zsNDX.html)、[SOX](https://quote.eastmoney.com/gb/zsSOX.html)、[NBI](https://quote.eastmoney.com/gb/zsNBI.html)、[行情中心](https://quote.eastmoney.com/center/gridlist.html)。

## 请求逐项记录（完整实际URL）

1. **stock-get：200**。JSON rc=0。

   `https://push2.eastmoney.com/api/qt/stock/get?secid=100.SPX&fields=f43%2Cf57%2Cf58%2Cf59%2Cf60%2Cf86%2Cf124%2Cf169%2Cf170%2Cf171%2Cf292%2Cf301&fltt=2&invt=2`

2. **stock-get：200**。JSON rc=100。

   `https://push2.eastmoney.com/api/qt/stock/get?secid=100.IXIC&fields=f43%2Cf57%2Cf58%2Cf59%2Cf60%2Cf86%2Cf124%2Cf169%2Cf170%2Cf171%2Cf292%2Cf301&fltt=2&invt=2`

3. **stock-get：200**。JSON rc=0。

   `https://push2.eastmoney.com/api/qt/stock/get?secid=251.SOX&fields=f43%2Cf57%2Cf58%2Cf59%2Cf60%2Cf86%2Cf124%2Cf169%2Cf170%2Cf171%2Cf292%2Cf301&fltt=2&invt=2`

4. **stock-get：200**。JSON rc=0。

   `https://push2.eastmoney.com/api/qt/stock/get?secid=251.NBI&fields=f43%2Cf57%2Cf58%2Cf59%2Cf60%2Cf86%2Cf124%2Cf169%2Cf170%2Cf171%2Cf292%2Cf301&fltt=2&invt=2`

5. **ndx-identity：无HTTP响应**。RemoteDisconnected: Remote end closed connection without response

   `https://push2.eastmoney.com/api/qt/stock/get?secid=100.NDX&fields=f43%2Cf57%2Cf58%2Cf59%2Cf60%2Cf86%2Cf169%2Cf170&fltt=2&invt=2`

6. **ndx-history：200**。JSON rc=0。

   `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=100.NDX&fields1=f1%2Cf2%2Cf3%2Cf4%2Cf5%2Cf6&fields2=f51%2Cf52%2Cf53%2Cf54%2Cf55%2Cf56%2Cf57%2Cf58%2Cf59%2Cf60%2Cf61&klt=101&fqt=0&beg=20261013&end=20261014&lmt=3`

7. **us-industry-example：200**。JSON rc=0。

   `https://push2.eastmoney.com/api/qt/clist/get?fs=b%3AMK0216&fields=f12%2Cf13%2Cf14%2Cf2%2Cf3%2Cf18%2Cf124&fltt=2&invt=2&pz=3&pn=1&fid=f3&po=1&np=1`

8. **browser-batch-cors：200**。实际浏览器跨域成功，JSON rc=0、4条有效指数。

   `https://push2.eastmoney.com/api/qt/ulist.np/get?secids=100.SPX,100.NDX,251.SOX,251.NBI&fields=f12,f13,f14,f2,f3,f18,f124,f152&fltt=2&invt=2`

## CORS与Safari边界

已用系统Edge的全新隔离上下文，实际打开 https://ynm3000.netlify.app/，从该真实HTTPS源执行普通fetch(mode=cors, credentials=omit, cache=no-store, redirect=error)，批量请求HTTP200、Response.type=cors、四条有效记录。不是curl成功推断浏览器成功。单项HTTP响应Access-Control-Allow-Origin均为*；无Cookie、认证、伪造Referer、公共代理或JSONP。

iPhone Safari/PWA未接入真机，不能声称已验证。普通匿名GET+CORS在协议层具备可行条件，仍需iPhone及其实际移动网络验收。源无已确认的公开API稳定性/固定延迟/长期免费额度承诺；本次位于美股收盘后，不能由一次样本推断盘中延迟分钟数及持续更新频率。页面保守标“延迟报价”，超过20分钟标“较旧报价”，该阈值不是供应商服务保证。没有将SPX 15:59:46的报价称为最终官方收盘。

## 行业结论

官网行情中心配置提供六个美股组：科技MK0216、金融MK0217、医药食品MK0218、汽车能源MK0219、媒体MK0220、制造零售MK0221。它们是个股列表，不是NASDAQ/NYSE各11行业的averageChange。实际只测科技组一页3条：total=29，返回OPEN、ERIC、CTSH及各自价格/涨跌幅，证明不是行业整体收益。

未找到并验证与FMP的NASDAQ11+NYSE11大行业、NASDAQ127+NYSE128细分行业等价的匿名接口，也未验证其分类/历史/成分权重可复现FMP统计口径。不使用A股BK行业榜或六粗分组冒充。行业继续读取已发布JSON及设备离线副本，真实已有日期仍只有2026-10-14。后续行业新交易日仍需原有FMP采集、公开JSON同步与正常部署，不能宣称全看板已免每日数据发布。

## 本地实现边界

四指数最新延迟报价使用上面的批量JSON接口，一次请求4项；独立localStorage键monster-slayer-kit:us-market:index-quotes:v1。进入一次+手动按钮、30秒冷却持久化、并发合并、12秒超时、无轮询/自动重试，离开取消。代码/市场/名称、价格、昨收、百分比、日期和时间均通过校验才替换完整旧报价；时间倒退拒绝。失败显示最后有效缓存，无有效实时副本则用Git历史JSON。损坏/未知版本缓存保护原文。第三方动态响应不进入Service Worker静态缓存。

最新视图中四指数显示独立纽约报价时间，行业收盘日期/口径不随其更改。选择更早历史日期时只用当日/之前真实收盘数据，最新指数不填入历史。历史文件和原采集器不变。有效设备副本在首次异步读取前展示，首次设备读取期间显示“读取中”，不假称暂无数据。

黄金/Brent控制器、接口、昨结口径、缓存与刷新不变；仅修正一处“正在获取”提示文字，不再声称四指数永远读收盘缓存。三个计算器业务代码不动，原有5处未提交修改保持原样。

数据使用与再展示授权仍未确认；技术可访问不构成长久采集/再展示许可。保留东方财富、FMP、FRED/Nasdaq来源链接及版权；本轮仅本地开发，不提交、不推送、不部署。

## 最终验证结果

最终完整自动化114/114通过，0失败、0跳过（详见Windows私有目录local-data/us-market/em-live-research/final-regression.txt）。所有行情功能测试均Mock，外部未Mock请求被拦截；覆盖三计算器、30秒防重、取消/失败/离线缓存、日期/历史隔离、PWA升级和公开数据包。320/375/390/430/1440px布局无横向溢出，人工检查320与1440px Mock截图。公开JSON完整性及本地构建通过，仍为5个文件、2026-10-14唯一行业快照。原始/公开历史及原有5处用户修改哈希不变；跟踪文件和新增文件未包含本机FMP密钥。

本地开发版本v1.4.0-dev.12，服务http://127.0.0.1:3000/tools/us-market/；页面和新脚本HTTP200。本轮未提交、推送或部署；实际行情请求最终仍8次，FMP/FRED均0次。后续用户主动打开验收页面会按设计各尝试一次指数、商品请求，不属于本报告已执行请求。
