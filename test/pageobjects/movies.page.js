const { $, $$, browser } = require('@wdio/globals')
const Page = require('./page')

function normalizeMovieTitle(text) {
    return text.replace(/\s+\((?:N\/A|\d{4})\)\s*$/, '').trim()
}

class MoviesPage extends Page {
    get heading () {
        return $('h1=Movies')
    }

    get searchInput () {
        return $('input[placeholder="Search by title..."]')
    }

    get searchSubmitButton () {
        return $('form button[type="submit"]')
    }

    get movieCards () {
        return $$('div.bg-white.rounded-lg.shadow-md')
    }

    get recommendationsLink () {
        return $("//a[normalize-space()='Recommendations']")
    }

    get profileLink () {
        return $("//a[normalize-space()='Profile']")
    }

    async open () {
        return super.open('/movies')
    }

    async waitForLoaded () {
        await browser.waitUntil(
            async () => (await this.heading.isExisting()) || (await this.recommendationsLink.isExisting()),
            {
                timeout: 10000,
                timeoutMsg: 'Movies page did not load after login'
            }
        )
    }

    async goToRecommendations () {
        await this.recommendationsLink.waitForClickable()
        await this.recommendationsLink.click()
    }

    async goToProfile () {
        await this.profileLink.waitForClickable()
        await this.profileLink.click()
    }

    async getFirstMovieTitle () {
        const cards = await this.movieCards
        if (!cards.length) {
            throw new Error('No movies were found on the Movies page')
        }

        const titleElement = await cards[0].$('h2')
        return normalizeMovieTitle(await titleElement.getText())
    }

    async likeFirstUnlikedMovie () {
        const cards = await this.movieCards

        for (const card of cards) {
            const button = await card.$('button')
            if (!await button.isExisting()) {
                continue
            }

            const buttonText = (await button.getText()).trim()
            if (buttonText !== 'Like') {
                continue
            }

            const titleElement = await card.$('h2')
            const movieTitle = normalizeMovieTitle(await titleElement.getText())

            await button.waitForClickable()
            await button.click()

            await browser.waitUntil(
                async () => (await button.getText()).trim() !== 'Like',
                {
                    timeout: 10000,
                    timeoutMsg: `Movie "${movieTitle}" was not liked`
                }
            )

            return movieTitle
        }

        throw new Error('No unliked movie was found on the Movies page')
    }

    async search(query) {
        await this.searchInput.waitForDisplayed()
        await this.searchInput.setValue(query)
        await this.searchSubmitButton.waitForClickable()
        await this.searchSubmitButton.click()
    }
}

module.exports = new MoviesPage()
