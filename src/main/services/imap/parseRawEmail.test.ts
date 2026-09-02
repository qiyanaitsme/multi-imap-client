// Regression tests for parseRawEmail body extraction.
// Covers: multipart bounds, nested multiparts, headerless parts, preamble,
// and the last-resort fallback that prevents "(ÐŸÑƒÑÑ‚Ð¾Ðµ Ð¿Ð¸ÑÑŒÐ¼Ð¾)" rendering.
import { describe, it, expect } from 'vitest'
import { ImapConnection } from './ImapConnection'

const conn: any = new (ImapConnection as any)()

function parse(raw: string) {
  const buf = Buffer.from(raw, 'binary')
  return conn.parseRawEmail(buf.toString('latin1'), buf)
}

describe('parseRawEmail body extraction', () => {
  it('multipart/alternative: bodies end at their own boundary (no tail leak)', () => {
    const raw = [
      'From: "Steam Support" <noreply@steampowered.com>',
      'To: someone@example.com',
      'Subject: Your Steam account',
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="----=_Part_1234"',
      '',
      'This is a multi-part message in MIME format.',
      '------=_Part_1234',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Dear player,=20',
      'new sign in detected.',
      '------=_Part_1234',
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      '<html><body><h1>Dear player</h1><p>new sign in</p></body></html>',
      '------=_Part_1234--',
      '',
    ].join('\r\n')
    const r = parse(raw)
    expect(r.textBody).toBe('Dear player, \r\nnew sign in detected.')
    expect(r.htmlBody).toBe('<html><body><h1>Dear player</h1><p>new sign in</p></body></html>')
    expect(r.attachments.length).toBe(0)
  })

  it('multipart/alternative: preamble does not win the textBody race', () => {
    const raw = [
      'From: a@b.c',
      'Subject: t',
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary=BOUND_X',
      '',
      'This is a multi-part message in MIME format.',
      '--BOUND_X',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'real text body',
      '--BOUND_X',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>real html body</p>',
      '--BOUND_X--',
      '',
    ].join('\r\n')
    const r = parse(raw)
    expect(r.textBody).toBe('real text body')
    expect(r.htmlBody).toBe('<p>real html body</p>')
  })

  it('headerless part (no Content-Type) defaults to text/plain', () => {
    const raw = [
      'From: noreply@example.com',
      'Subject: code',
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary=ALT_1',
      '',
      '--ALT_1',
      '',
      'Your code is 4821',
      '--ALT_1',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Your code is 4821</p>',
      '--ALT_1--',
      '',
    ].join('\r\n')
    const r = parse(raw)
    expect(r.textBody).toBe('Your code is 4821')
    expect(r.htmlBody).toBe('<p>Your code is 4821</p>')
  })

  it('multipart/mixed with nested alternative: nested bodies are aligned, not headers', () => {
    const raw = [
      'From: a@b.c',
      'Subject: t',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="MIXED_Y"',
      '',
      '--MIXED_Y',
      'Content-Type: multipart/alternative; boundary="ALT_Z"',
      '',
      '--ALT_Z',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'plain part',
      '--ALT_Z',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>html part</p>',
      '--ALT_Z--',
      '',
      '--MIXED_Y',
      'Content-Type: application/pdf; name="doc.pdf"',
      'Content-Disposition: attachment; filename="doc.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      'JVBERi0xLjQ=',
      '--MIXED_Y--',
      '',
    ].join('\r\n')
    const r = parse(raw)
    expect(r.textBody).toBe('plain part')
    expect(r.htmlBody).toBe('<p>html part</p>')
    expect(r.attachments.length).toBe(1)
    expect(r.attachments[0].filename).toBe('doc.pdf')
  })

  it('base64 single-part html still parses', () => {
    const html = '<html><body><h1>Hi</h1></body></html>'
    const raw = [
      'From: a@b.c',
      'Subject: t',
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(html).toString('base64').replace(/(.{76})/g, '$1\r\n'),
      '',
    ].join('\r\n')
    const r = parse(raw)
    expect(r.htmlBody).toBe(html)
  })

  it('body misflagged as text attachment is recovered instead of empty', () => {
    const raw = [
      'From: a@b.c',
      'Subject: t',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="MIX_A"',
      '',
      '--MIX_A',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Disposition: attachment',
      '',
      'the actual readable text',
      '--MIX_A--',
      '',
    ].join('\r\n')
    const r = parse(raw)
    expect(r.textBody).toContain('the actual readable text')
  })

  it('unknown structure with plain body still yields text', () => {
    const raw = [
      'From: a@b.c',
      'Subject: t',
      'MIME-Version: 1.0',
      'Content-Type: multipart/x-weird; boundary=WB',
      '',
      'just some text, no real parts',
      '--WB--',
      '',
    ].join('\r\n')
    const r = parse(raw)
    expect(r.textBody).toContain('just some text, no real parts')
  })

  it('relay-mangled mail: boundary only in body, headerless parts, QP content', () => {
    // Real-world pattern from a temp-mail relay: top-level Content-Type was
    // stripped (its boundary parameter ended up glued to the preamble line in
    // the body), parts carry no headers at all, and content is quoted-printable.
    const raw = [
      'From: noreply@steampowered.com',
      'To: jeffreyuvmontoya99613@example.com',
      'Subject: Your Steam account: Access from new web or device',
      '',
      'This is a multi-part message in MIME format. boundary="np6a91e209ed310"',
      '--np6a91e209ed310',
      '=0ADear jeffreyuvmontoya99613,=0A=0AIt looks like you are trying to log in from a new device.',
      'Login Code B5CVQ =0A Cheers,=0AThe Steam Team=0A',
      '--np6a91e209ed310',
      '<html><body><table><tr><td>Spain</td></tr>',
      '<tr><td>B5CVQ</td></tr></table></body></html>',
      '--np6a91e209ed310--',
      '',
    ].join('\r\n')
    const r = parse(raw)
    // QP was decoded (no =0A artifacts survive)
    expect(r.textBody).toContain('\nDear jeffreyuvmontoya99613,')
    expect(r.textBody).toContain('B5CVQ')
    // html part recognized and clean
    expect(r.htmlBody).toContain('<td>B5CVQ</td>')
    expect(r.htmlBody).not.toContain('=0A')
  })

  it('relay collapsed newlines: delimiters glued mid-line, top-level CT spoofed as text/html', () => {
    // Real-world pattern: the relay replaced the multipart Content-Type with
    // text/html and glued the preamble, the boundary delimiters and the whole
    // text/plain part into ONE physical line. Without mid-line boundary
    // recovery the whole blob lands in htmlBody.
    const giantLine =
      ' New sign in to Steam From your account "ujeremyxparks35690" Location of sign in: Darayya, Rif Dimashq, SY ' +
      'If not, please reset your Steam password now. ' +
      'View this message on the web: https://store.steampowered.com/email/NewDeviceAlert?sparams=eJxtkM1OwzAMgF9lynnaKNUo&check=2a3d75cc6b8e1d431e6af47 '
    const htmlPart =
      '<html><body><meta name=3D"format-detection" content=3D"telephone=3Dno" />' +
      '<table><tr><td>Darayya</td></tr><tr><td>B5CVQ</td></tr></table>' +
      '<a href=3D"https://help.steampowered.com">Click here.</a></body></html>'
    const raw = [
      'From: noreply@steampowered.com',
      'To: ujeremyxparks35690@example.com',
      'Subject: New sign in to Steam',
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      'This is a multi-part message in MIME format. boundary="np6a924e0b26efd" --np6a924e0b26efd' + giantLine + '--np6a924e0b26efd',
      htmlPart,
      '--np6a924e0b26efd--',
      '',
    ].join('\r\n')
    const r = parse(raw)
    // The blob was split: text part â†’ textBody, html part â†’ htmlBody
    expect(r.textBody).toContain('New sign in to Steam')
    expect(r.textBody).toContain('Darayya')
    expect(r.htmlBody).toContain('<td>B5CVQ</td>')
    // QP in the html part decoded, no MIME garbage anywhere
    expect(r.htmlBody).toContain('name="format-detection"')
    expect(r.htmlBody).not.toContain('=3D')
    expect(r.textBody).not.toContain('--np6a924e0b26efd')
    expect(r.htmlBody).not.toContain('--np6a924e0b26efd')
    expect(r.textBody).not.toContain('This is a multi-part')
  })

  it('relay erased the boundary declaration entirely â€” delimiters alone are enough', () => {
    // Same relay family as above, but this time the "boundary=..." declaration
    // is gone from the body completely; only the delimiter lines remain and
    // the top-level CT is spoofed as text/html. The whole blob used to land
    // in htmlBody because boundary detection was gated on "boundary=" text.
    const textPart =
      'Dear ujeremyxparks35690, It looks like you are trying to log in from a new device. ' +
      'Login Code Q4GWJ Request made from Kazakhstan.'
    const htmlPart =
      '<html><body><table><tr><td>Kazakhstan</td></tr><tr><td>Q4GWJ</td></tr></table></body></html>'
    const raw = [
      'From: noreply@steampowered.com',
      'To: ujeremyxparks35690@example.com',
      'Subject: Your Steam account: Access from new web or device',
      'Content-Type: text/html; charset=utf-8',
      '',
      'This is a multi-part message in MIME format.',
      '--np6a91dce668e5e',
      textPart,
      '--np6a91dce668e5e',
      htmlPart,
      '--np6a91dce668e5e--',
      '',
    ].join('\r\n')
    const r = parse(raw)
    expect(r.textBody).toContain('Login Code Q4GWJ')
    expect(r.htmlBody).toContain('<td>Q4GWJ</td>')
    expect(r.textBody).not.toContain('--np6a91dce668e5e')
    expect(r.htmlBody).not.toContain('--np6a91dce668e5e')
    expect(r.textBody).not.toContain('This is a multi-part')
  })

  it('genuinely plain single-part mail is never mistaken for multipart', () => {
    const raw = [
      'From: a@b.c',
      'Subject: hello',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Just a plain letter. v1.2.3-beta -- https://example.com/x?y=zz',
      'Nothing multipart about it.',
      '',
    ].join('\r\n')
    const r = parse(raw)
    expect(r.textBody).toContain('Just a plain letter.')
    expect(r.textBody).toContain('Nothing multipart about it.')
  })

  it('relay letter Tashkent: declaration after preamble, headerless parts, <a> tags in text part', () => {
    // Exact structure from the user's real letter: top-level CT is gone, the
    // detached boundary declaration sits after the preamble, parts have no
    // headers at all, and the "text" part contains inline <a> tags (relay
    // artifact) that must NOT steal the htmlBody slot from the full html part.
    const raw = [
      'From: Steam Support <noreply@steampowered.com>',
      'To: ujeremyxparks35690@example.com',
      'Subject: New sign in to Steam',
      '',
      'This is a multi-part message in MIME format.',
      '',
      ' boundary="np6a97b812b8c6a"',
      '',
      '--np6a97b812b8c6a',
      '',
      '',
      'New sign in to Steam',
      'From your account "ujeremyxparks35690"',
      '',
      'Location of sign in:',
      'Tashkent, Toshkent, UZ',
      '',
      'Authorized by:',
      'Steam Guard code from your email',
      '',
      'Get the <a href="https://store.steampowered.com/mobile">Steam Mobile',
      'Authenticator</a> to view and control the devices that have access to your',
      'account.',
      '',
      'View this message on the web:',
      'https://store.steampowered.com/email/NewDeviceAlert?sparams=eJx&check=66e61b98',
      '--np6a97b812b8c6a',
      '',
      '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">',
      '<html><body><table><tr><td>Tashkent, Toshkent, UZ</td></tr><tr><td>Steam Guard code from your email</td></tr></table></body></html>',
      '',
      '--np6a97b812b8c6a--',
      '',
    ].join('\r\n')
    const r = parse(raw)
    expect(r.textBody).toContain('Tashkent, Toshkent, UZ')
    expect(r.htmlBody).toContain('<!DOCTYPE')
    expect(r.htmlBody).toContain('<td>Tashkent, Toshkent, UZ</td>')
    expect(r.textBody).not.toContain('This is a multi-part')
    expect(r.textBody).not.toContain('--np6a97b812b8c6a')
    expect(r.htmlBody).not.toContain('--np6a97b812b8c6a')
  })

  it('folded part Content-Type: nested boundary survives header continuation lines', () => {
    // Real-world Steam letter (uid 23, temp-mail relay): the part's
    // Content-Type folds across two lines, so the nested multipart/alternative
    // boundary sits on a continuation line. A fold-unaware part-header parser
    // dropped it, both body parts were discarded, and the last-resort fallback
    // rendered the raw MIME source (preamble + delimiters) as the letter body.
    const raw = [
      'Return-Path: <noreply@steampowered.com>',
      'Subject: New sign in to Steam',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="m6a97b812b8c6b"',
      '',
      'This is a multi-part message in MIME format.',
      '--m6a97b812b8c6b',
      'Content-Type: multipart/alternative;',
      ' boundary="np6a97b812b8c6a"',
      '',
      '--np6a97b812b8c6a',
      'Content-Type: text/plain; charset=UTF-8; format=flowed',
      '',
      'New sign in to Steam',
      'Location of sign in: Tashkent, Toshkent, UZ',
      '--np6a97b812b8c6a',
      'Content-Type: text/html; charset=UTF-8',
      '',
      '<html><body><td>Tashkent, Toshkent, UZ</td></body></html>',
      '--np6a97b812b8c6a--',
      '--m6a97b812b8c6b--',
      '',
    ].join('\r\n')
    const r = parse(raw)
    expect(r.textBody).toContain('New sign in to Steam')
    expect(r.textBody).toContain('Tashkent, Toshkent, UZ')
    expect(r.htmlBody).toContain('<html>')
    expect(r.textBody).not.toContain('This is a multi-part')
    expect(r.textBody).not.toContain('np6a97b812b8c6a')
    expect(r.htmlBody).not.toContain('np6a97b812b8c6a')
    expect(r.textBody).not.toContain('Content-Type')
  })

  it('last-resort fallback: preamble is dropped when the whole body is surfaced', () => {
    // A fragment whose header block has no "key: value" line is stray text and
    // gets skipped, so the structural parse yields nothing and the fallback
    // surfaces the decoded body. Even then the MIME preamble ("This is a
    // multi-part message...") must never reach the rendered body.
    const raw = [
      'From: a@b.c',
      'Subject: t',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="zzz123"',
      '',
      'This is a multi-part message in MIME format.',
      '--zzz123',
      'just a stray line without a colon',
      '',
      'real remaining content',
      '--zzz123--',
      '',
    ].join('\r\n')
    const r = parse(raw)
    expect(r.textBody).toContain('real remaining content')
    expect(r.textBody).not.toContain('This is a multi-part')
    expect(r.textBody).not.toContain('--zzz123')
  })
})
