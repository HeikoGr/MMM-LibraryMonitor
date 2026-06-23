const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLoginRequest,
  hasAccountOverview,
  parseAccountHtml,
  parseGermanDate,
} = require("../lib/open-account-parser");

test("parseGermanDate converts dd.MM.yyyy to ISO format", () => {
  assert.equal(parseGermanDate("24.06.2026"), "2026-06-24");
  assert.equal(parseGermanDate(""), null);
});

test("buildLoginRequest preserves hidden fields and injects credentials", () => {
  const html = `
    <html>
      <body>
        <form action="/mannheim/de-de/Mein-Konto">
          <input type="hidden" name="__VIEWSTATE" value="abc123">
          <input type="text" name="ctl00$Main$txtUsername" value="">
          <input type="password" name="ctl00$Main$txtPassword" value="">
          <input type="submit" name="ctl00$Main$cmdLogin" value="Anmelden">
          <input type="text" name="ctl00$Main$txtResetCode" value="reset-me">
          <input type="password" name="ctl00$Main$txtResetPwd" value="should-not-post">
          <input type="submit" name="ctl00$Main$BtnReset" value="Zuruecksetzen">
        </form>
      </body>
    </html>
  `;

  const request = buildLoginRequest(
    html,
    "https://bibliotheken.komm.one/mannheim/de-de/Mein-Konto",
    {
      username: "12345",
      password: "secret",
    },
  );

  assert.equal(request.postUrl, "https://bibliotheken.komm.one/mannheim/de-de/Mein-Konto");
  assert.match(request.body, /__VIEWSTATE=abc123/);
  assert.match(request.body, /txtUsername=12345/);
  assert.match(request.body, /txtPassword=secret/);
  assert.match(request.body, /cmdLogin=Anmelden/);
  assert.doesNotMatch(request.body, /txtResetCode=/);
  assert.doesNotMatch(request.body, /txtResetPwd=/);
  assert.doesNotMatch(request.body, /BtnReset=/);
});

test("parseAccountHtml extracts loans, fees, validity, and warning", () => {
  const html = `
    <html>
      <body>
        <div class="dnnFormWarning">Hinweis zur Verlängerung</div>
        <span id="ctl00_tpnlFees_ucFeesView_lblTotalSaldoData">1,50 EUR</span>
        <span id="ctl00_ucPatronAccountView_LblMembershipValidUntilData">31.12.2026</span>
        <table id="ctl00_tpnlLoans_ucLoansView_grdViewLoans">
          <tr>
            <th><input type="checkbox"></th>
            <th>Cover</th>
            <th><a href="#">Titel</a></th>
            <th><a href="#">Sort$Author</a></th>
            <th><a href="#">Sort$MediaGroup</a></th>
            <th><a href="#">Sort$Branch</a></th>
            <th><a href="#">Sort$DueDate</a></th>
          </tr>
          <tr>
            <td><input name="copy1"></td>
            <td>
              <img
                src="/Mannheim/DesktopModules/OCLC.OPEN.PL.DNN.BaseLibrary/StyleSheets/Images/Fallbacks/emptyURL.gif?11.1.0.10"
                data-sources="SetSimpleCover|a|https://images-eu.ssl-images-amazon.com/images/P/3833905255.03.MZZZZZZZ.jpg|a|http://www.amazon.de/exec/obidos/ASIN/3833905255"
              >
            </td>
            <td><a href="/de-de/Mediensuche?id=42">Roman A</a></td>
            <td>Autor A</td>
            <td>Buch</td>
            <td>Zentralbibliothek</td>
            <td>24.06.2026</td>
          </tr>
          <tr>
            <td><input name="copy2"></td>
            <td></td>
            <td><a href="/de-de/Mediensuche?id=43">Spiel B</a></td>
            <td></td>
            <td>Spiel</td>
            <td>Neckarau</td>
            <td>26.06.2026</td>
          </tr>
        </table>
      </body>
    </html>
  `;

  const result = parseAccountHtml(html);

  assert.equal(hasAccountOverview(html), true);
  assert.equal(result.totalItems, 2);
  assert.equal(result.pendingFees, "-1,50 EUR");
  assert.equal(result.validUntil, "31.12.2026");
  assert.equal(result.warning, "Hinweis zur Verlängerung");
  assert.equal(result.items[0].id, "42");
  assert.equal(result.items[0].title, "Roman A");
  assert.equal(result.items[0].branch, "Zentralbibliothek");
  assert.equal(result.items[0].dueDate, "2026-06-24");
  assert.equal(
    result.items[0].coverImageUrl,
    "https://images-eu.ssl-images-amazon.com/images/P/3833905255.03.MZZZZZZZ.jpg",
  );
});