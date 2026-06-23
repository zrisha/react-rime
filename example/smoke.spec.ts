import { test, expect } from '@playwright/test'

// Real-WASM smoke test: loads the example (consuming react-rime as a package),
// lets the engine deploy from jsdelivr, and verifies the full round trip.
// Requires network access to cdn.jsdelivr.net.

test('pinyin round trip: ni hao -> candidates -> commit', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  await page.goto('/')

  // Engine downloads rime.wasm/.data + luna-pinyin dict from CDN; allow time.
  await expect(page.getByTestId('status')).toHaveText('ready', { timeout: 60_000 })

  const input = page.getByTestId('input')
  await input.click()
  await input.pressSequentially('nihao', { delay: 60 })

  // Candidates should appear while composing.
  const candidates = page.getByTestId('candidates')
  await expect(candidates).toBeVisible({ timeout: 10_000 })
  const candidateText = await candidates.innerText()
  console.log('candidates:', candidateText.replace(/\s+/g, ' '))
  expect(candidateText).toMatch(/[一-鿿]/) // contains a CJK character

  // Commit the first candidate with space.
  await input.press('Space')

  const buffer = page.getByTestId('buffer')
  await expect(buffer).toHaveText(/[一-鿿]/, { timeout: 10_000 })
  console.log('committed buffer:', await buffer.innerText())

  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([])
})
