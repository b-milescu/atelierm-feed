// Builds a Google Merchant / Pinterest catalog feed (RSS 2.0 + g:) from the public WooCommerce Store API.
const SITE = "https://atelierm.ro";
const out = process.argv[2] ?? "feed.xml";

type Product = {
  id: number; name: string; permalink: string; short_description: string; description: string;
  is_in_stock: boolean; images: { src: string }[]; categories: { name: string }[];
  prices: { price: string; regular_price: string; sale_price: string; currency_code: string; currency_minor_unit: number };
};

const products: Product[] = [];
for (let page = 1; ; page++) {
  const res = await fetch(`${SITE}/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
  if (!res.ok) throw new Error(`page ${page}: HTTP ${res.status}`);
  const batch = (await res.json()) as Product[];
  products.push(...batch);
  if (page >= Number(res.headers.get("x-wp-totalpages"))) break;
}

const decode = (s: string) => s
  .replace(/<[^>]+>/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'")
  .replace(/\s+/g, " ").trim();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (p: Product["prices"], v: string) => `${(+v / 10 ** p.currency_minor_unit).toFixed(2)} ${p.currency_code}`;

const items = products.filter(p => p.images.length && +p.prices.price > 0).map(p => {
  const title = decode(p.name).slice(0, 150);
  const desc = (decode(p.description) || decode(p.short_description) || title).slice(0, 5000);
  const sale = p.prices.sale_price !== p.prices.regular_price;
  return `<item>
<g:id>${p.id}</g:id>
<g:title>${esc(title)}</g:title>
<g:description>${esc(desc)}</g:description>
<g:link>${esc(p.permalink)}</g:link>
<g:image_link>${esc(p.images[0].src)}</g:image_link>
${p.images.slice(1, 11).map(i => `<g:additional_image_link>${esc(i.src)}</g:additional_image_link>`).join("\n")}
<g:availability>${p.is_in_stock ? "in_stock" : "out_of_stock"}</g:availability>
<g:price>${money(p.prices, p.prices.regular_price)}</g:price>
${sale ? `<g:sale_price>${money(p.prices, p.prices.sale_price)}</g:sale_price>` : ""}
<g:condition>new</g:condition>
<g:brand>AtelierM</g:brand>
<g:identifier_exists>no</g:identifier_exists>
<g:product_type>${esc(decode(p.categories.map(c => c.name).join(" > ")))}</g:product_type>
</item>`;
});

if (items.length === 0) throw new Error("no products with image and price; refusing to publish an empty feed");

await Bun.write(out, `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>
<title>AtelierM</title><link>${SITE}</link><description>Pictură manuală pe țesătură, Brașov</description><lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items.join("\n")}
</channel></rss>
`);
console.log(`${items.length}/${products.length} products -> ${out}`);
