const { $, $$, browser } = require('@wdio/globals')
const Page = require('./page')

class GenreResultsPage extends Page {
    headingForGenre(genre) {
        return $(`h1=${genre} Movies`)
    }

    get errorMessage () {
        return $('div.text-red-500 p')
    }

    get emptyState () {
        return $('div*=No movies in')
    }

    get resultCards () {
        return $$('div.bg-white.rounded-lg.shadow-md')
    }

    async waitForLoaded(genre) {
        await browser.waitUntil(
            async () => {
                return (
                    await this.headingForGenre(genre).isExisting() ||
                    await this.errorMessage.isExisting() ||
                    await this.emptyState.isExisting() ||
                    (await this.resultCards).length > 0
                )
            },
            {
                timeout: 10000,
                timeoutMsg: `Genre results page for "${genre}" did not finish loading`
            }
        )
    }

    async getResultGenres() {
        const cards = await this.resultCards
        const genres = []

        for (const card of cards) {
            const genreElement = await card.$('p.text-sm.text-gray-600')
            if (await genreElement.isExisting()) {
                genres.push(await genreElement.getText())
            }
        }

        return genres
    }
}

module.exports = new GenreResultsPage()
