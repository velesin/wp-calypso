/**
 * External dependencies
 */
import React from 'react';
import page from 'page';

/**
 * Internal dependencies
 */
import Main from 'components/main';
import Card from 'components/card';
import OlarkChatbox from 'components/olark-chatbox';
import olarkStore from 'lib/olark-store';
import olarkActions from 'lib/olark-store/actions';
import olarkEvents from 'lib/olark-events';
import HelpContactForm from 'me/help/help-contact-form';
import HelpContactConfirmation from 'me/help/help-contact-confirmation';
import HeaderCake from 'components/header-cake';
import wpcomLib from 'lib/wp';
import notices from 'notices';
import siteList from 'lib/sites-list';
import analytics from 'analytics';

/**
 * Module variables
 */
const wpcom = wpcomLib.undocumented();
const sites = siteList();

module.exports = React.createClass( {
	displayName: 'HelpContact',

	componentDidMount: function() {
		olarkStore.on( 'change', this.updateOlarkState );
		olarkEvents.on( 'api.chat.onOperatorsAway', this.onOperatorsAway );
		olarkEvents.on( 'api.chat.onCommandFromOperator', this.onCommandFromOperator );

		sites.on( 'change', this.onSitesChanged );

		olarkActions.updateDetails();

		// The following lines trick olark into thinking we are interacting with it. This interaction
		// makes olark fire off its onOperatorsAway and onOperatorsAvailable events sooner.
		olarkActions.expandBox();
		olarkActions.shrinkBox();
		olarkActions.hideBox();
	},

	componentWillUnmount: function() {
		const { details, isOperatorAvailable } = this.state.olark;

		olarkStore.removeListener( 'change', this.updateOlarkState );
		olarkEvents.off( 'api.chat.onOperatorsAway', this.onOperatorsAway );
		olarkEvents.off( 'api.chat.onCommandFromOperator', this.onCommandFromOperator );

		if ( details.isConversing && ! isOperatorAvailable ) {
			olarkActions.shrinkBox();
		}

		sites.removeListener( 'change', this.onSitesChanged );
	},

	getInitialState: function() {
		return {
			olark: olarkStore.get(),
			isSubmitting: false,
			confirmation: null,
			isChatEnded: false,
			sitesInitialized: sites.initialized
		};
	},

	updateOlarkState: function() {
		this.setState( { olark: olarkStore.get() } );
	},

	onSitesChanged: function() {
		this.setState( { sitesInitialized: sites.initialized } );
	},

	backToHelp: function() {
		page( '/help' );
	},

	startChat: function( contactForm ) {
		const { message, howCanWeHelp, howYouFeel, siteSlug } = contactForm;
		const site = sites.getSite( siteSlug );

		// Intentionally not translated since only HE's will see this in the olark console as a notification.
		const notifications = [
			'How can you help: ' + howCanWeHelp,
			'How I feel: ' + howYouFeel,
			'Site I need help with: ' + ( site ? site.URL : 'N/A' )
		];

		notifications.forEach( olarkActions.sendNotificationToOperator );

		analytics.tracks.recordEvent( 'calypso_help_live_chat_begin' );

		this.sendMessageToOperator( message );
	},

	submitKayakoTicket: function( contactForm ) {
		const { subject, message, howCanWeHelp, howYouFeel, siteSlug } = contactForm;
		const { locale } = this.state.olark;
		const site = sites.getSite( siteSlug );

		const ticketMeta = [
			'How can you help: ' + howCanWeHelp,
			'How I feel: ' + howYouFeel,
			'Site I need help with: ' + ( site ? site.URL : 'N/A' )
		];

		const kayakoMessage = [ ...ticketMeta, '\n', message ].join( '\n' );

		this.setState( { isSubmitting: true } );

		wpcom.submitKayakoTicket( subject, kayakoMessage, locale, ( error ) => {
			if ( error ) {
				// TODO: bump a stat here
				notices.error( error.message );

				this.setState( { isSubmitting: false } );
				return;
			}

			this.setState( {
				isSubmitting: false,
				confirmation: {
					title: this.translate( 'We\'re on it!' ),
					message: this.translate(
						'We\'ve received your message, and you\'ll hear back from ' +
						'one of our Happiness Engineers shortly.' )
				}
			} );

			analytics.tracks.recordEvent( 'calypso_help_contact_submit', { ticket_type: 'kayako' } );
		} );
	},

	submitSupportForumsTopic: function( contactForm ) {
		const { subject, message } = contactForm;

		this.setState( { isSubmitting: true } );

		wpcom.submitSupportForumsTopic( subject, message, ( error, data ) => {
			if ( error ) {
				// TODO: bump a stat here
				notices.error( error.message );

				this.setState( { isSubmitting: false } );
				return;
			}

			this.setState( {
				isSubmitting: false,
				confirmation: {
					title: this.translate( 'Got it!' ),
					message: this.translate(
						'Your message has been submitted to our ' +
						'{{a}}community forums{{/a}}',
						{
							components: {
								a: <a href={ data.topic_URL } />
							}
						}
					)
				}
			} );

			analytics.tracks.recordEvent( 'calypso_help_contact_submit', { ticket_type: 'forum' } );
		} );
	},

	/**
	 * Send a message to an olark operator.
	 * @param  {string} message The message to be sent to an operator
	 */
	sendMessageToOperator: function( message ) {
		// Get the DOM element of the olark textarea
		const widgetInput = window.document.getElementById( 'habla_wcsend_input' );
		const KEY_ENTER = 13;

		if ( ! widgetInput ) {
			// We couldn't find the input box in the olark widget so return false since we can't send the message
			return;
		}

		// Theres no api call that sends a message to an operator so in order to achieve this we send a fake
		// "enter" keypress event that olark will be listening for. The enter key event is what then triggers the sending of
		// the message.

		// Show the olark box so that we may manipulate it.
		// You can only send a message when the olark box is expanded.
		olarkActions.expandBox();

		// Send focus to the textarea because olark expects it.
		widgetInput.focus();

		// IE requires this to be executed before the value is set, don't know why.
		widgetInput.onkeydown( { keyCode: KEY_ENTER } );
		widgetInput.value = message;

		// Trigger the onkeydown callback added by olark so that we can send the message to the operator.
		widgetInput.onkeydown( { keyCode: KEY_ENTER } );
	},

	onOperatorsAway: function() {
		const { details } = this.state.olark;

		if ( ! details.isConversing ) {
			analytics.tracks.recordEvent( 'calypso_help_offline_form_display', {
				form_type: 'kayako'
			} );
		}
	},

	onCommandFromOperator: function( event ) {
		if ( event.command.name === 'end' ) {
			this.setState( { isChatEnded: true } );
		}
	},

	/**
	 * Get the view for the contact page. This could either be the olark chat widget if a chat is in progress or a contact form.
	 * @return {object} A JSX object that should be rendered
	 */
	getView: function() {
		const { olark, confirmation, sitesInitialized, isSubmitting, isChatEnded } = this.state;
		const showChatVariation = olark.isUserEligible && olark.isOperatorAvailable;
		const showKayakoVariation = ! showChatVariation && ( olark.details.isConversing || olark.isUserEligible );
		const showForumsVariation = ! ( showChatVariation || showKayakoVariation );

		if ( confirmation ) {
			return <HelpContactConfirmation { ...confirmation } />;
		}

		if ( ! ( olark.isOlarkReady && sitesInitialized ) ) {
			return <div className="help-contact__placeholder" />;
		}

		if ( isChatEnded || ( olark.details.isConversing && olark.isOperatorAvailable ) ) {
			return <OlarkChatbox />;
		}

		const contactFormProps = Object.assign(
			{
				disabled: isSubmitting,
				showSubjectField: showKayakoVariation || showForumsVariation,
				showHowCanWeHelpField: showKayakoVariation || showChatVariation,
				showHowYouFeelField: showKayakoVariation || showChatVariation,
				showSiteField: ( showKayakoVariation || showChatVariation ) && ( sites.get().length > 1 )
			},
			showChatVariation && {
				onSubmit: this.startChat,
				buttonLabel: this.translate( 'Chat with us' )
			},
			showKayakoVariation && {
				onSubmit: this.submitKayakoTicket,
				buttonLabel: isSubmitting ? this.translate( 'Submitting support ticket' ) : this.translate( 'Submit support ticket' )
			},
			showForumsVariation && {
				onSubmit: this.submitSupportForumsTopic,
				buttonLabel: isSubmitting ? this.translate( 'Asking in the forums' ) : this.translate( 'Ask in the forums' ),
				formDescription: this.translate(
					'Post a new question in our {{strong}}public forums{{/strong}}, ' +
					'where it may be answered by helpful community members, ' +
					'by submitting the form below. ' +
					'{{strong}}Please do not{{/strong}} provide financial or ' +
					'contact information when submitting this form.',
					{
						components: {
							strong: <strong />
						}
					} )
			}
		);

		// Hide the olark widget in the bottom right corner.
		olarkActions.hideBox();

		return <HelpContactForm { ...contactFormProps } />;
	},

	render: function() {
		return (
			<Main className="help-contact">
				<HeaderCake onClick={ this.backToHelp } isCompact={ true }>{ this.translate( 'Contact Us' ) }</HeaderCake>
				<Card>
					{ this.getView() }
				</Card>
			</Main>
		);
	}
} );
