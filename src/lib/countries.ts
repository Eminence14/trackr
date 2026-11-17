export const AFRICA = ['Nigeria', 'Ghana', 'Kenya', 'South Africa', 'Uganda', 'Tanzania', 'Cameroon', 'Ethiopia', 'Rwanda', 'Zimbabwe', 'Zambia', 'Senegal', "Cote d'Ivoire", 'Egypt', 'Morocco', 'Sierra Leone', 'Liberia', 'Malawi', 'Botswana', 'Namibia', 'Mozambique', 'Other African country']
export const OTHERS = ['India', 'Pakistan', 'Bangladesh', 'Nepal', 'Philippines', 'Indonesia', 'Brazil', 'Mexico', 'United Kingdom', 'United States', 'Canada', 'Other']
export const COUNTRIES = [...AFRICA, ...OTHERS]
export const DEGREES = ['Undergraduate', 'Masters', 'PhD', 'Postdoc', 'Short course', 'Any']
export const NATIONALITY: Record<string, string> = { Nigeria: 'Nigerian', Ghana: 'Ghanaian', Kenya: 'Kenyan', 'South Africa': 'South African', Uganda: 'Ugandan', Tanzania: 'Tanzanian', Cameroon: 'Cameroonian', Ethiopia: 'Ethiopian', Rwanda: 'Rwandan', Zimbabwe: 'Zimbabwean', Zambia: 'Zambian', Senegal: 'Senegalese', Egypt: 'Egyptian', Morocco: 'Moroccan', 'Sierra Leone': 'Sierra Leonean', Liberia: 'Liberian', Malawi: 'Malawian', Botswana: 'Motswana', Namibia: 'Namibian', Mozambique: 'Mozambican', India: 'Indian', Pakistan: 'Pakistani', Bangladesh: 'Bangladeshi', Nepal: 'Nepali', Philippines: 'Filipino', Indonesia: 'Indonesian', Brazil: 'Brazilian', Mexico: 'Mexican', 'United Kingdom': 'British', 'United States': 'American', Canada: 'Canadian' }
export const SOURCES = [
  { id: 'whatsapp', label: 'WhatsApp groups and channels', tip: 'Long-press a message, tap Share, and choose Trackr. Or copy the message and paste it into Add.' },
  { id: 'linkedin', label: 'LinkedIn', tip: 'On a post, tap Share, then Copy link or Send via, and choose Trackr. If it will not read, paste the text.' },
  { id: 'x', label: 'X (Twitter)', tip: 'Tap Share on the post and choose Trackr, or copy the link and paste it into Add.' },
  { id: 'telegram', label: 'Telegram', tip: 'Forward or share the message to Trackr, or paste its text into Add.' },
  { id: 'facebook', label: 'Facebook and Instagram', tip: 'Share the post to Trackr, or take a screenshot and add it.' },
  { id: 'blogs', label: 'Scholarship blogs and newsletters', tip: 'Copy the page link and paste it into Add. Trackr then checks the official page for the real deadline.' },
  { id: 'official', label: 'University or funder websites', tip: 'Paste the link. Official pages read best.' },
]
