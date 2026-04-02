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
        return $$("//h2[contains(normalize-space(), 'Liked Movies')]/following-sibling::div[contains(@class,'grid')][1]/div[contains(@class,'bg-white') and contains(@class,'rounded-lg') and contains(@class,'shadow-md')]")
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
        const cards = await this.likedMovieCards
        const titles = []

        for (const card of cards) {
            const titleElement = await card.$('h3')
            if (await titleElement.isExisting()) {
                titles.push(normalizeMovieTitle(await titleElement.getText()))
            }
        }

        return titles
    }

    async hasMovie(title) {
        const titles = await this.getLikedMovieTitles()
        return titles.includes(title)
    }

    async unlikeMovie(title) {
        const cards = await this.likedMovieCards

        for (const card of cards) {
            const titleElement = await card.$('h3')
            if (!await titleElement.isExisting()) {
                continue
            }

            const cardTitle = normalizeMovieTitle(await titleElement.getText())
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
                async () => !(await this.hasMovie(title)),
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
