const { $, $$, browser } = require('@wdio/globals')
const Page = require('./page')

class RecommendationsPage extends Page {
    get heading () {
        return $('h1=Recommendations')
    }

    get cards () {
        return $$('div.bg-white.rounded-lg.shadow-md')
    }

    get errorMessage () {
        return $('div.text-red-500 p')
    }

    get emptyState () {
        return $('div=No recommendations yet. Like some movies to get personalized suggestions!')
    }

    open () {
        return super.open('/recommendations')
    }

    async waitForLoaded () {
        await browser.waitUntil(
            async () => {
                return (
                    await this.heading.isExisting() ||
                    await this.emptyState.isExisting() ||
                    await this.errorMessage.isExisting() ||
                    (await this.cards).length > 0
                )
            },
            {
                timeout: 10000,
                timeoutMsg: 'Recommendations page did not finish loading'
            }
        )
    }
}

module.exports = new RecommendationsPage()
