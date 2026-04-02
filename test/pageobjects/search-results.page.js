const { $, $$, browser } = require('@wdio/globals')
const Page = require('./page')

class SearchResultsPage extends Page {
    get heading () {
        return $('h1*=Search Results for')
    }

    get errorMessage () {
        return $('div.text-red-500 p')
    }

    get emptyState () {
        return $('div*=No movies found for')
    }

    get resultCards () {
        return $$('div.bg-white.rounded-lg.shadow-md')
    }

    async waitForLoaded () {
        await browser.waitUntil(
            async () => {
                return (
                    await this.heading.isExisting() ||
                    await this.errorMessage.isExisting() ||
                    await this.emptyState.isExisting() ||
                    (await this.resultCards).length > 0
                )
            },
            {
                timeout: 10000,
                timeoutMsg: 'Search results page did not finish loading'
            }
        )
    }

    async getResultTitles () {
        const cards = await this.resultCards
        const titles = []

        for (const card of cards) {
            const titleElement = await card.$('h2')
            if (await titleElement.isExisting()) {
                titles.push(await titleElement.getText())
            }
        }

        return titles
    }
}

module.exports = new SearchResultsPage()
