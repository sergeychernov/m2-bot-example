import axios from 'axios';

export async function getAddressFromLocation(lat: number, lon: number): Promise<string> {
    const YANDEX_GEOCODE_API = 'https://geocode-maps.yandex.ru/1.x';
    const API_KEY = process.env.YANDEX_MAP_API_KEY;

    try {
        const response = await axios.get(YANDEX_GEOCODE_API, {
            params: {
                format: 'json',
                geocode: `${lon},${lat}`,
                apikey: API_KEY,
                lang: 'ru_RU',
                results: 1
            }
        });

        const featureMember = response.data.response.GeoObjectCollection.featureMember;
        if (featureMember.length > 0) {
            return featureMember[0].GeoObject.metaDataProperty.GeocoderMetaData.text;
        }
        return 'Адрес не определен';
    } catch (error) {
        console.error('Yandex Geocode error:', error);
        return 'Ошибка определения адреса';
    }
}