function renderTag(p, idPrefix='tag') {
  const type = getTplType(p);
  const tagId = `${idPrefix}-${cssId(p.sku)}`;
  const qrId  = `qr-${idPrefix}-${cssId(p.sku)}`;
  const bcId  = `bc-${idPrefix}-${cssId(p.sku)}`;

  const imgHtml = p.image
    ? `<img src="${escapeAttr(p.image)}" onerror="this.style.display='none';this.parentElement.innerHTML='<div class=t-img-empty>📦</div>'" alt="" crossorigin="anonymous">`
    : `<div class="t-img-empty">📦</div>`;

  const footer = `
    <div class="t-foot">
      <div class="t-sku">${escapeHtml(p.sku||'')}</div>
      <div id="${bcId}"></div>
      <div id="${qrId}"></div>
    </div>`;

  const priceStr = fmtThaiBaht(p.price);
  const escName = escapeHtml(p.name);
  const escUnit = escapeHtml(p.unit||'บาท');
  const escSize = p.size ? escapeHtml(p.size) : '';

  let html = '';

  if (type === 'sale') {
    /* เทพธัญญะ — image left | (name + old + yellow pill) middle | red circle right */
    html = `
      <div class="tag tpl-sale" id="${tagId}">
        <div class="t-img">${imgHtml}</div>
        <div class="t-info">
          <div class="t-info-left">
            <div class="t-name">${escName}</div>
            ${p.oldPrice > p.price ? `<div class="t-circle-old">ปกติ ${fmtThaiBaht(p.oldPrice)}.-</div>` : ''}
            <div class="t-yellow-strip">${escUnit}${escSize ? ' · '+escSize : ''}</div>
          </div>
          <div class="t-price-circle">
            <div class="t-circle-label">พิเศษ</div>
            <div class="t-price">${priceStr}.-</div>
          </div>
          ${footer}
        </div>
      </div>`;
  } else if (type === 'new') {
    /* Clean white green-frame + ribbon NEW! badge */
    html = `
      <div class="tag tpl-new" id="${tagId}">
        <div class="t-new-badge">NEW!</div>
        <div class="t-img">${imgHtml}</div>
        <div class="t-info">
          <div class="t-name">${escName}</div>
          ${escSize ? `<div class="t-size">${escSize}</div>` : ''}
          <div class="t-price-row">
            <span class="t-currency">฿</span>
            <span class="t-price">${priceStr}</span>
          </div>
          <div class="t-unit">${escUnit}</div>
          ${footer}
        </div>
      </div>`;
  } else if (type === 'bogo') {
    /* ฮงล้ง — image left | (name + promo banner + old) middle | comic burst right */
    const promoText = escapeHtml(p.promo || 'ซื้อ 1 แถม 1');
    html = `
      <div class="tag tpl-bogo" id="${tagId}">
        <div class="t-img">${imgHtml}</div>
        <div class="t-info">
          <div class="t-info-left">
            <div class="t-name">${escName}</div>
            <div class="t-promo-banner">${promoText}</div>
            ${p.oldPrice > p.price ? `<div class="t-old-line">(ปกติ ${fmtThaiBaht(p.oldPrice)} บาท)</div>` : `<div class="t-old-line">${escUnit}${escSize ? ' · '+escSize : ''}</div>`}
          </div>
          <div class="t-burst-wrap">
            <div class="t-burst">
              <div class="t-burst-shape"></div>
              <div class="t-burst-content">
                <div class="label">SALE</div>
                <div class="t-price">${priceStr}.-</div>
              </div>
            </div>
          </div>
          ${footer}
        </div>
      </div>`;
  } else {
    /* Regular — อิศราภัณฑ์ clean modern: image left | name+price right */
    html = `
      <div class="tag tpl-regular" id="${tagId}">
        <div class="t-img">${imgHtml}</div>
        <div class="t-info">
          <div class="t-name">${escName}</div>
          ${escSize ? `<div class="t-size">${escSize}</div>` : ''}
          ${p.oldPrice > p.price ? `<div class="t-old-pill">ปกติ ฿${fmtThaiBaht(p.oldPrice)}</div>` : ''}
          <div class="t-price-row">
            <span class="t-currency">฿</span>
            <span class="t-price">${priceStr}</span>
          </div>
          <div class="t-unit">${escUnit}</div>
          ${footer}
        </div>
      </div>`;
  }
  return { html, qrId, bcId };
}