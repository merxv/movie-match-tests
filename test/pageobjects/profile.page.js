const { $, $$, browser } = require('@wdio/globals')
const Page = require('./page')

function normalizeMovieTitle(text) {
    return text.replace(/\s+\((?:N\/A|\d{4})\)\s*$/, '').trim()
}

class ProfilePage extends Page {
    get heading () {
        return $('h1=Profile')
    }

    get errorMessage () {
        return $('div.text-red-500 p')
    }

    get emptyState () {
        return $('div=No liked movies yet. Go like some!')
    }

    get likedMovieCards () {
        return $$("//h2[contains(normalize-space(), 'Liked Movies')]/following-sibling::*[1]//div[contains(@class,'bg-white') and contains(@class,'rounded-lg') and contains(@class,'shadow-md')]")
    }

    open () {
        return super.open('/profile')
    }

    async waitForLoaded () {
        await browser.waitUntil(
            async () => {
                return (
                    await this.heading.isExisting() ||
                    await this.errorMessage.isExisting() ||
                    await this.emptyState.isExisting() ||
                    (await this.likedMovieCards).length > 0
                )
            },
            {
                timeout: 10000,
                timeoutMsg: 'Profile page did not finish loading'
            }
        )
    }

    async getLikedMovieTitles () {
        const titles = await browser.execute(() => {
            const heading = Array.from(document.querySelectorAll('h2'))
                .find((element) => element.textContent.includes('Liked Movies'))

            if (!heading) {
                return []
            }

            const container = heading.nextElementSibling
            if (!container) {
                return []
            }

            const cards = Array.from(
                container.querySelectorAll('div.bg-white.rounded-lg.shadow-md')
            )

            if (!cards.length) {
                return []
            }

            return cards
                .map((card) => {
                    const heading = card.querySelector('h3')
                    if (heading?.textContent?.trim()) {
                        return heading.textContent.trim()
                    }

                    const image = card.querySelector('img[alt]')
                    return image?.alt?.trim() || ''
                })
                .filter(Boolean)
        })

        return titles.map(normalizeMovieTitle)
    }

    async hasMovie(title) {
        const titles = await this.getLikedMovieTitles()
        return titles.includes(title)
    }

    async unlikeMovie(title) {
        const cards = await this.likedMovieCards

        for (const card of cards) {
            let cardTitle = ''
            const titleElement = await card.$('h3')
            if (await titleElement.isExisting()) {
                cardTitle = normalizeMovieTitle(await titleElement.getText())
            } else {
                const poster = await card.$('img')
                if (await poster.isExisting()) {
                    cardTitle = normalizeMovieTitle(await poster.getAttribute('alt'))
                }
            }

            if (cardTitle !== title) {
                continue
            }

            await card.scrollIntoView({ block: 'center', inline: 'nearest' })
            await browser.pause(300)
            await browser.execute(() => window.scrollBy(0, 250))
            await browser.pause(300)

            const button = await card.$('button')
            await button.scrollIntoView({ block: 'center', inline: 'nearest' })
            await button.waitForClickable()
            await button.click()

            await browser.waitUntil(
                async () => {
                    const titles = await this.getLikedMovieTitles()
                    return !titles.includes(title)
                },
                {
                    timeout: 10000,
                    timeoutMsg: `Movie "${title}" was not removed from profile`
                }
            )

            return
        }

        throw new Error(`Liked movie "${title}" was not found in profile`)
    }
}

module.exports = new ProfilePage()
