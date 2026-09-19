from __future__ import annotations

from suryakavach.ingest.pradan_catalogue import parse_catalogue_page


def test_parse_catalogue_page_extracts_product_identity_and_observation_window():
    html = """
    <tbody id="tableForm:lazyDocTable_data">
      <tr data-ri="0">
        <td>1</td>
        <td><a href="/al1/protected/downloadData/solexs/level1/2024/02/x.zip?solexs"> x.zip </a></td>
        <td>2024-02-12T00:00:00.000Z</td>
        <td>2024-02-12T23:59:59.000Z</td>
        <td>8525.191</td>
      </tr>
    </tbody>
    """

    products = parse_catalogue_page(html, "https://pradan.issdc.gov.in", "solexs")

    assert len(products) == 1
    product = products[0]
    assert product.payload == "solexs"
    assert product.filename == "x.zip"
    assert product.download_url == "https://pradan.issdc.gov.in/al1/protected/downloadData/solexs/level1/2024/02/x.zip?solexs"
    assert product.observation_start == "2024-02-12T00:00:00.000Z"
    assert product.observation_end == "2024-02-12T23:59:59.000Z"
    assert product.size_kib == 8525.191


def test_parse_catalogue_page_returns_no_products_when_the_jsf_table_is_absent():
    assert parse_catalogue_page("<html>expired</html>", "https://pradan.issdc.gov.in", "solexs") == []
